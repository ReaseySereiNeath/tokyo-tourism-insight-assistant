"""The import pipeline shared by every dataset and file format.

    upload bytes
      -> preserve the original file under data/raw/<scope>/ (never modified)
      -> read the table (CSV or Excel)
      -> check columns, validate + normalize every row
      -> if ANY row is invalid: reject the whole file, store the errors, change nothing
      -> otherwise upsert: new -> insert, identical -> count as duplicate,
         same key but revised value -> update and keep the old value in `revisions`
      -> record counts on the import batch

All-or-nothing keeps imports predictable: you fix the file and re-import it,
and duplicate handling makes that re-import safe.
"""
import hashlib
import io
import json
import re
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

from app.db import Scope, raw_dir, utcnow
from app.importers.common import ParseError, clean_text, make_evidence_id
from app.importers.datasets import DATASETS, Dataset

MAX_ERRORS_STORED = 200


class ImportRejected(Exception):
    pass


@dataclass
class RowError:
    row: int | None  # spreadsheet row number as the user sees it (header = row 1)
    column: str | None
    message: str

    def as_dict(self) -> dict:
        return {"row": self.row, "column": self.column, "message": self.message}


@dataclass
class ParsedFile:
    records: list[dict] = field(default_factory=list)
    errors: list[RowError] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    importer: str = "csv"


def preserve_raw_file(scope: Scope, filename: str, content: bytes) -> tuple[str, Path]:
    sha = hashlib.sha256(content).hexdigest()
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(filename).name)[-80:] or "upload"
    path = raw_dir(scope) / f"{sha[:16]}_{safe_name}"
    if not path.exists():
        path.write_bytes(content)
    return sha, path


def read_table(filename: str, content: bytes) -> tuple[pd.DataFrame, str]:
    """Read CSV or Excel into a DataFrame of raw strings (no type guessing)."""
    suffix = Path(filename).suffix.lower()
    if suffix in (".xlsx", ".xlsm"):
        df = pd.read_excel(io.BytesIO(content), sheet_name=0, dtype=object)
        return df, "excel"
    if suffix == ".csv":
        # keep_default_na=False: an empty cell stays "", so *we* decide it is missing.
        for encoding in ("utf-8-sig", "cp932"):  # cp932 = Japanese Excel CSV exports
            try:
                df = pd.read_csv(io.BytesIO(content), dtype=str, keep_default_na=False, encoding=encoding)
                return df, "csv"
            except UnicodeDecodeError:
                continue
        raise ImportRejected("Could not decode the CSV. Save it as UTF-8 and try again.")
    raise ImportRejected(f"Unsupported file type '{suffix}'. Use .csv or .xlsx.")


def _normalize_header(name) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(name).strip().lower()).strip("_")


def parse_tabular(dataset: Dataset, df: pd.DataFrame, importer: str) -> ParsedFile:
    result = ParsedFile(importer=importer)
    df = df.rename(columns=_normalize_header)
    known = {c.name for c in dataset.columns}

    missing = [c for c in dataset.required_columns if c not in df.columns]
    if missing:
        result.errors.append(RowError(None, ", ".join(missing),
                                      f"Missing required column(s): {', '.join(missing)}. "
                                      f"Download the template to see the expected header."))
        return result
    unknown = [c for c in df.columns if c not in known]
    if unknown:
        result.warnings.append(f"Ignored unknown column(s): {', '.join(map(str, unknown))}")

    if df.empty:
        result.errors.append(RowError(None, None, "The file has a header but no data rows."))
        return result

    for idx, raw in enumerate(df.to_dict(orient="records")):
        row_number = idx + 2  # +1 for the header, +1 for 1-based numbering
        if all(clean_text(v) is None for v in raw.values()):
            continue  # fully blank line
        try:
            record = dataset.normalize(raw)
        except ParseError as exc:
            col = next((c for c in sorted(known, key=len, reverse=True) if str(exc).startswith(c)), None)
            result.errors.append(RowError(row_number, col, str(exc)))
            continue
        record["_row"] = row_number
        result.records.append(record)
    return result


def _evidence_id(dataset: Dataset, record: dict, scope: Scope) -> str:
    return make_evidence_id(dataset.id_prefix, [record.get(k) for k in dataset.key_fields], scope)


def _same(a, b) -> bool:
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(float(a) - float(b)) < 1e-9
    return a == b


def write_records(conn: sqlite3.Connection, scope: Scope, dataset: Dataset, parsed: ParsedFile,
                  batch_id: int) -> dict:
    counts = {"inserted": 0, "duplicate": 0, "updated": 0}
    now = utcnow()
    seen_in_file: dict[str, dict] = {}

    for record in parsed.records:
        row_number = record.pop("_row", None)
        eid = _evidence_id(dataset, record, scope)

        # The same key twice inside one file: identical -> duplicate, different -> error.
        if eid in seen_in_file:
            if all(_same(seen_in_file[eid].get(f), record.get(f)) for f in dataset.mutable_fields):
                counts["duplicate"] += 1
                continue
            parsed.errors.append(RowError(row_number, None,
                                          "Conflicts with an earlier row in this file that has the same key "
                                          f"({', '.join(dataset.key_fields)}) but different values."))
            continue
        seen_in_file[eid] = record

        existing = conn.execute(f"SELECT * FROM {dataset.table} WHERE evidence_id = ?", (eid,)).fetchone()
        if existing is None:
            values = {**record, "evidence_id": eid, "batch_id": batch_id, "created_at": now}
            if dataset.table == "visitor_stats":
                values["updated_at"] = now
            cols = ", ".join(values)
            conn.execute(f"INSERT INTO {dataset.table} ({cols}) VALUES ({', '.join('?' * len(values))})",
                         list(values.values()))
            counts["inserted"] += 1
            continue

        changed = {f: record.get(f) for f in dataset.mutable_fields
                   if record.get(f) is not None and not _same(existing[f], record.get(f))}
        if not changed:
            counts["duplicate"] += 1
            continue
        for f, new in changed.items():
            conn.execute(
                "INSERT INTO revisions (evidence_id, field, old_value, new_value, batch_id, changed_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (eid, f, None if existing[f] is None else str(existing[f]), str(new), batch_id, now),
            )
        sets = {**changed, "batch_id": batch_id}
        if dataset.table == "visitor_stats":
            sets["updated_at"] = now
        conn.execute(f"UPDATE {dataset.table} SET {', '.join(f'{k} = ?' for k in sets)} WHERE evidence_id = ?",
                     [*sets.values(), eid])
        counts["updated"] += 1
    return counts


def run_import(conn: sqlite3.Connection, scope: Scope, dataset_name: str, filename: str, content: bytes,
               parser=None) -> dict:
    """Import one file. `parser(content, filename) -> ParsedFile` overrides the generic table reader
    (used by source-specific adapters such as the JNTO workbook)."""
    dataset = DATASETS.get(dataset_name)
    if dataset is None:
        raise ImportRejected(f"Unknown dataset '{dataset_name}'.")

    sha, path = preserve_raw_file(scope, filename, content)
    previous = conn.execute(
        "SELECT id, completed_at FROM import_batches WHERE file_sha256 = ? AND dataset = ? AND status = 'success' "
        "ORDER BY id DESC LIMIT 1", (sha, dataset_name)).fetchone()

    cur = conn.execute(
        "INSERT INTO import_batches (dataset, importer, original_filename, file_sha256, raw_path, status, started_at) "
        "VALUES (?, ?, ?, ?, ?, 'failed', ?)",
        (dataset_name, "pending", filename, sha, str(path), utcnow()))
    batch_id = cur.lastrowid
    conn.commit()

    try:
        if parser is not None:
            parsed = parser(content, filename)
        else:
            df, importer = read_table(filename, content)
            parsed = parse_tabular(dataset, df, importer)
    except ImportRejected as exc:
        parsed = ParsedFile(errors=[RowError(None, None, str(exc))], importer="unknown")
    except Exception as exc:  # unreadable/corrupt file
        parsed = ParsedFile(errors=[RowError(None, None, f"Could not read the file: {exc}")], importer="unknown")

    if previous is not None:
        parsed.warnings.append(f"This exact file was already imported (batch #{previous['id']}, "
                               f"{previous['completed_at']}). Existing records are not duplicated.")

    counts = {"inserted": 0, "duplicate": 0, "updated": 0}
    if not parsed.errors:
        try:
            counts = write_records(conn, scope, dataset, parsed, batch_id)
        except Exception:
            conn.rollback()
            raise
        if parsed.errors:  # conflicts discovered while writing -> undo everything
            conn.rollback()
            counts = {"inserted": 0, "duplicate": 0, "updated": 0}

    status = "rejected" if parsed.errors else "success"
    rows_total = len(parsed.records) + len({e.row for e in parsed.errors if e.row is not None})
    conn.execute(
        """UPDATE import_batches SET importer = ?, status = ?, rows_total = ?, rows_inserted = ?,
           rows_duplicate = ?, rows_updated = ?, errors_json = ?, warnings_json = ?, completed_at = ?
           WHERE id = ?""",
        (parsed.importer, status, rows_total, counts["inserted"], counts["duplicate"], counts["updated"],
         json.dumps([e.as_dict() for e in parsed.errors[:MAX_ERRORS_STORED]], ensure_ascii=False),
         json.dumps(parsed.warnings, ensure_ascii=False), utcnow(), batch_id))
    conn.commit()
    return get_batch(conn, batch_id)


def get_batch(conn: sqlite3.Connection, batch_id: int) -> dict:
    row = dict(conn.execute("SELECT * FROM import_batches WHERE id = ?", (batch_id,)).fetchone())
    row["errors"] = json.loads(row.pop("errors_json"))
    row["warnings"] = json.loads(row.pop("warnings_json"))
    row["error_count"] = len(row["errors"])
    return row
