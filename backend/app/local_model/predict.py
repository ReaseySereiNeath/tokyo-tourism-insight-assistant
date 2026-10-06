"""Label all feedback in a database with the trained local classifier.

Run:  python -m app.local_model.predict --scope real

Replaces every previous 'local' label in that database (like the keyword
rules, it is cheap enough to re-run on everything). Keyword and language-model
labels are left alone.
"""
import argparse
import sqlite3
import sys
from pathlib import Path

from app.db import SCOPES, connect, utcnow
from app.local_model import model_dir
from app.local_model import model as m
from app.local_model.train import decide_themes


class ModelMissing(RuntimeError):
    pass


def classify_feedback_local(conn: sqlite3.Connection, path: Path | None = None) -> dict:
    path = path or model_dir()
    if not (path / "meta.json").exists():
        raise ModelMissing("No trained model yet. Run python -m app.local_model.train first.")
    tokenizer, model, meta = m.load(path)
    device = m.pick_device()
    model.to(device)

    items = conn.execute("SELECT evidence_id, text FROM feedback ORDER BY evidence_id").fetchall()
    conn.execute("DELETE FROM feedback_themes WHERE method = 'local'")
    labels = 0
    if items:
        theme_probs, sent_probs = m.predict_probs(tokenizer, model, [r["text"] for r in items], device)
        chosen = decide_themes(theme_probs, meta["threshold"])
        now = utcnow()
        for i, item in enumerate(items):
            sentiment = meta["sentiments"][int(sent_probs[i].argmax())]
            for j in chosen[i].nonzero().squeeze(1).tolist():
                conn.execute(
                    "INSERT INTO feedback_themes (evidence_id, theme, method, model, sentiment, classified_at) "
                    "VALUES (?, ?, 'local', ?, ?, ?)",
                    (item["evidence_id"], meta["themes"][j], meta["label"], sentiment, now))
                labels += 1
    conn.commit()
    return {"method": "local", "model": meta["label"], "classified": len(items), "labels": labels}


def main() -> None:
    parser = argparse.ArgumentParser(description="Label feedback with the trained local classifier.")
    parser.add_argument("--scope", choices=SCOPES, default="real")
    parser.add_argument("--model", type=Path, default=None)
    args = parser.parse_args()
    conn = connect(args.scope)
    try:
        result = classify_feedback_local(conn, args.model)
    except ModelMissing as exc:
        sys.exit(str(exc))
    finally:
        conn.close()
    print(f"Labelled {result['classified']} feedback items in {args.scope}.db "
          f"({result['labels']} theme labels, model: {result['model']}).")


if __name__ == "__main__":
    main()
