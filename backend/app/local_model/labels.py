"""Labelling sheet: export feedback for review, and read the reviewed labels back.

The sheet is a CSV you edit in Numbers or Excel:

    evidence_id  language  text  themes                          sentiment  reviewed  suggested_by
    fb_...       en        ...   food_and_drink;pace_and_walking  mixed      yes       llm

- themes: one or more theme keys from app/analysis/themes.py, separated by ';'
- sentiment: positive | negative | mixed | neutral
- reviewed: set to 'yes' once you have checked the row. Only reviewed rows are
  used for training, so suggestions never become training data unchecked.

Suggestions are pre-filled from language-model labels when they exist, else
from keyword rules (themes only). Re-exporting keeps every row already in the
sheet untouched and appends feedback that is not in it yet.

Run:  python -m app.local_model.labels --scope real
"""
import argparse
import csv
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from app.analysis.themes import THEMES, keyword_themes
from app.db import SCOPES, connect
from app.local_model import SENTIMENTS, training_dir

COLUMNS = ["evidence_id", "language", "text", "themes", "sentiment", "reviewed", "suggested_by"]


@dataclass
class LabelledItem:
    evidence_id: str
    text: str
    themes: list[str]
    sentiment: str | None


class LabelError(ValueError):
    pass


def sheet_path(scope: str) -> Path:
    return training_dir() / f"labels_{scope}.csv"


def _suggestion(conn: sqlite3.Connection, evidence_id: str, text: str) -> tuple[list[str], str, str]:
    llm = conn.execute("SELECT theme, sentiment FROM feedback_themes WHERE evidence_id = ? AND method = 'llm' "
                       "ORDER BY theme", (evidence_id,)).fetchall()
    if llm:
        return [r["theme"] for r in llm], llm[0]["sentiment"] or "", "llm"
    return keyword_themes(text), "", "keyword"


def export_sheet(conn: sqlite3.Connection, path: Path) -> dict:
    """Write (or extend) the labelling sheet. Existing rows are never changed."""
    existing: list[dict] = []
    if path.exists():
        with path.open(newline="", encoding="utf-8-sig") as f:
            existing = list(csv.DictReader(f))
    known = {r["evidence_id"] for r in existing}
    added = []
    for item in conn.execute("SELECT evidence_id, language, text FROM feedback ORDER BY collection_date, evidence_id"):
        if item["evidence_id"] in known:
            continue
        themes, sentiment, source = _suggestion(conn, item["evidence_id"], item["text"])
        added.append({"evidence_id": item["evidence_id"], "language": item["language"], "text": item["text"],
                      "themes": ";".join(themes), "sentiment": sentiment, "reviewed": "",
                      "suggested_by": source})
    path.parent.mkdir(parents=True, exist_ok=True)
    # utf-8-sig so Excel shows Japanese text correctly.
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(existing + added)
    reviewed = sum(1 for r in existing if _is_yes(r.get("reviewed")))
    return {"path": str(path), "rows": len(existing) + len(added), "added": len(added), "reviewed": reviewed}


def _is_yes(value: str | None) -> bool:
    return (value or "").strip().lower() in {"yes", "y", "true", "1", "x"}


def load_reviewed(paths: list[Path]) -> list[LabelledItem]:
    """Reviewed rows from one or more sheets. Raises LabelError listing every problem found."""
    items: dict[str, LabelledItem] = {}
    problems: list[str] = []
    for path in paths:
        with path.open(newline="", encoding="utf-8-sig") as f:
            for line, row in enumerate(csv.DictReader(f), start=2):
                if not _is_yes(row.get("reviewed")):
                    continue
                where = f"{path.name} line {line}"
                themes = list(dict.fromkeys(t.strip() for t in (row.get("themes") or "").split(";") if t.strip()))
                unknown = [t for t in themes if t not in THEMES]
                if unknown:
                    problems.append(f"{where}: unknown theme(s) {', '.join(unknown)}")
                if not themes:
                    problems.append(f"{where}: no themes (use 'other' if nothing fits)")
                sentiment = (row.get("sentiment") or "").strip().lower() or None
                if sentiment and sentiment not in SENTIMENTS:
                    problems.append(f"{where}: sentiment must be one of {', '.join(SENTIMENTS)}")
                text = (row.get("text") or "").strip()
                if not text:
                    problems.append(f"{where}: empty text")
                items[row["evidence_id"]] = LabelledItem(row["evidence_id"], text, themes, sentiment)
    if problems:
        raise LabelError("Fix these rows in the labelling sheet:\n  " + "\n  ".join(problems))
    return list(items.values())


def main() -> None:
    parser = argparse.ArgumentParser(description="Export feedback to a labelling sheet.")
    parser.add_argument("--scope", choices=SCOPES, default="real")
    args = parser.parse_args()
    conn = connect(args.scope)
    try:
        result = export_sheet(conn, sheet_path(args.scope))
    finally:
        conn.close()
    print(f"Wrote {result['path']}: {result['rows']} rows ({result['added']} new, "
          f"{result['reviewed']} already reviewed).")
    print("Theme keys: " + ", ".join(THEMES))
    print("Next: check each row's themes and sentiment, set reviewed=yes, then run python -m app.local_model.train")


if __name__ == "__main__":
    main()
