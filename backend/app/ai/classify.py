"""Feedback classification with a language model, in small bounded batches.

Only items without an 'llm' label are sent, at most AI_CLASSIFY_MAX_ITEMS per
run, AI_CLASSIFY_BATCH_SIZE per request. Labels that reference unknown items
are ignored and counted. If a batch fails, earlier batches are kept and the
error is reported.
"""
import sqlite3

from pydantic import ValidationError

from app.ai.provider import LLMProvider, ProviderError
from app.ai.schemas import ClassificationOutput
from app.config import Settings
from app.db import utcnow


def classify_feedback_llm(conn: sqlite3.Connection, provider: LLMProvider, settings: Settings) -> dict:
    pending = conn.execute(
        """SELECT evidence_id, text, language FROM feedback
           WHERE evidence_id NOT IN (SELECT evidence_id FROM feedback_themes WHERE method = 'llm')
           ORDER BY collection_date, evidence_id LIMIT ?""", (settings.ai_classify_max_items,)).fetchall()
    summary = {"method": "llm", "model": provider.model, "requested": len(pending), "classified": 0,
               "ignored_labels": 0, "missing_labels": 0, "error": None}
    size = settings.ai_classify_batch_size
    for start in range(0, len(pending), size):
        batch = pending[start:start + size]
        items = [{"evidence_id": r["evidence_id"], "language": r["language"],
                  "text": r["text"][: settings.ai_max_excerpt_chars]} for r in batch]
        try:
            output = ClassificationOutput.model_validate(provider.classify_feedback(items))
        except ProviderError as exc:
            summary["error"] = exc.message
            break
        except ValidationError:
            summary["error"] = "The model returned labels in an unexpected format; this batch was skipped."
            break
        wanted = {r["evidence_id"] for r in batch}
        labeled = set()
        now = utcnow()
        for label in output.labels:
            if label.evidence_id not in wanted or label.evidence_id in labeled:
                summary["ignored_labels"] += 1
                continue
            labeled.add(label.evidence_id)
            for theme in dict.fromkeys(label.themes):
                conn.execute(
                    "INSERT OR REPLACE INTO feedback_themes (evidence_id, theme, method, model, sentiment, classified_at) "
                    "VALUES (?, ?, 'llm', ?, ?, ?)",
                    (label.evidence_id, theme, getattr(provider, "last_served_model", None) or provider.model,
                     label.sentiment, now))
        conn.commit()
        summary["classified"] += len(labeled)
        summary["missing_labels"] += len(wanted - labeled)
    return summary
