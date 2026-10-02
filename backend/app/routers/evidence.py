"""Trace any evidence ID back to its record, import batch, original file and source."""
import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from app.ai.report import RECORD_ID, RECORD_TABLES
from app.db import Scope, rows
from app.routers.deps import db, scope_param

router = APIRouter(prefix="/api", tags=["evidence"])

DATASET_FOR_TABLE = {"visitor_stats": "visitor_stats", "competitor_offers": "competitor_offers",
                     "feedback": "feedback", "news": "news"}


@router.get("/evidence/{evidence_id}")
def evidence(evidence_id: str, scope: Scope = Depends(scope_param), conn: sqlite3.Connection = Depends(db)):
    m = RECORD_ID.match(evidence_id)
    if not m:
        raise HTTPException(400, "Not a record evidence ID (expected e.g. FB-1A2B3C4D5E6F).")
    if evidence_id.startswith("DEMO-") != (scope == "demo"):
        raise HTTPException(404, f"{evidence_id} belongs to the {'demo' if scope == 'real' else 'real'} data scope.")
    table = RECORD_TABLES[m.group(1)]
    record = conn.execute(f"SELECT * FROM {table} WHERE evidence_id = ?", (evidence_id,)).fetchone()
    if record is None:
        raise HTTPException(404, "No record with this ID (it may have been removed or never existed).")
    record = dict(record)
    batch = conn.execute(
        "SELECT id, importer, original_filename, file_sha256, raw_path, completed_at FROM import_batches WHERE id = ?",
        (record["batch_id"],)).fetchone()
    source_name = record.get("source") or record.get("publisher")
    source = conn.execute("SELECT * FROM sources WHERE name = ?", (source_name,)).fetchone()
    out = {
        "evidence_id": evidence_id, "type": table, "record": record,
        "import_batch": dict(batch) if batch else None,
        "source": dict(source) if source else None,
        "revisions": rows(conn.execute("SELECT * FROM revisions WHERE evidence_id = ? ORDER BY id", (evidence_id,))),
    }
    if table == "feedback":
        out["themes"] = rows(conn.execute(
            "SELECT theme, method, model, sentiment, classified_at FROM feedback_themes WHERE evidence_id = ?",
            (evidence_id,)))
    return out


@router.get("/sources")
def sources(conn: sqlite3.Connection = Depends(db)):
    return rows(conn.execute("SELECT * FROM sources ORDER BY name"))
