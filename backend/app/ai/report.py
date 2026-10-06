"""Report generation: evidence -> provider -> validation -> storage.

Validation happens in two layers:
1. Schema: the response must match ReportOutput (types, required fields, limits).
2. Citations: every cited ID must be in the evidence pack that was sent, and
   every record ID must exist in the database. An insight with any invalid
   citation is removed and the removal is recorded, never silently kept.
"""
import json
import re
import sqlite3

from pydantic import ValidationError

from app.ai.evidence import build_evidence_pack, citable_ids
from app.ai.provider import LLMProvider, ProviderError
from app.ai.schemas import ReportOutput
from app.config import Settings
from app.db import utcnow

RECORD_TABLES = {"VS": "visitor_stats", "SP": "spending_stats", "CO": "competitor_offers", "FB": "feedback",
                 "NW": "news"}
RECORD_ID = re.compile(r"^(?:DEMO-)?(VS|SP|CO|FB|NW)-[0-9A-F]{12}$")


def record_exists(conn: sqlite3.Connection, evidence_id: str) -> bool:
    m = RECORD_ID.match(evidence_id)
    if not m:
        return False
    table = RECORD_TABLES[m.group(1)]
    return conn.execute(f"SELECT 1 FROM {table} WHERE evidence_id = ?", (evidence_id,)).fetchone() is not None


def validate_report(raw: dict, pack: dict, conn: sqlite3.Connection) -> tuple[dict | None, dict]:
    validation = {"schema_valid": False, "schema_errors": [], "removed_insights": [], "checked_ids": 0}
    try:
        report = ReportOutput.model_validate(raw)
    except ValidationError as exc:
        validation["schema_errors"] = [
            {"location": ".".join(str(p) for p in e["loc"]), "message": e["msg"]} for e in exc.errors()[:20]]
        return None, validation
    validation["schema_valid"] = True

    allowed = citable_ids(pack)
    fact_ids = {f["id"] for f in pack["facts"]}
    kept = []
    for index, insight in enumerate(report.insights):
        bad = []
        for eid in insight.evidence_ids:
            validation["checked_ids"] += 1
            if eid not in allowed:
                bad.append({"id": eid, "reason": "not in the evidence pack sent to the model"})
            elif eid not in fact_ids and not record_exists(conn, eid):
                bad.append({"id": eid, "reason": "no such record in the database"})
        if bad:
            validation["removed_insights"].append({"index": index, "finding": insight.finding[:200], "invalid_ids": bad})
            continue
        if insight.customer_segment and not insight.segment_support:
            insight.limitations.append("A customer segment was named without stating supporting evidence.")
        kept.append(insight)
    report.insights = kept
    return report.model_dump(), validation


def save_report(conn: sqlite3.Connection, provider: LLMProvider, model: str | None, status: str, pack: dict,
                result: dict | None, validation: dict, error: str | None) -> int:
    cur = conn.execute(
        """INSERT INTO reports (created_at, provider, model, is_example, status, evidence_json, result_json,
                                validation_json, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (utcnow(), provider.name, model, int(provider.is_example), status, json.dumps(pack, ensure_ascii=False),
         None if result is None else json.dumps(result, ensure_ascii=False),
         json.dumps(validation, ensure_ascii=False), error))
    conn.commit()
    return cur.lastrowid


def generate_report(conn: sqlite3.Connection, scope: str, provider: LLMProvider, settings: Settings) -> int:
    pack = build_evidence_pack(conn, scope, settings)
    try:
        raw = provider.generate_report(pack)
    except ProviderError as exc:
        return save_report(conn, provider, provider.model, "failed", pack, None,
                           {"provider_error": exc.kind}, exc.message)

    served_model = getattr(provider, "last_served_model", None) or provider.model
    result, validation = validate_report(raw, pack, conn)
    if result is None:
        return save_report(conn, provider, served_model, "failed", pack, None, validation,
                           "The model's answer did not match the required structure, so it was discarded.")
    if validation["removed_insights"] and not result["insights"]:
        status, error = "failed", "Every insight cited evidence that does not exist, so all were discarded."
    elif validation["removed_insights"]:
        status, error = "partial", None
    else:
        status, error = "success", None
    return save_report(conn, provider, served_model, status, pack, result, validation, error)


def load_report(conn: sqlite3.Connection, report_id: int) -> dict | None:
    row = conn.execute("SELECT * FROM reports WHERE id = ?", (report_id,)).fetchone()
    if row is None:
        return None
    r = dict(row)
    r["evidence"] = json.loads(r.pop("evidence_json"))
    result_json = r.pop("result_json")
    r["result"] = json.loads(result_json) if result_json else None
    r["validation"] = json.loads(r.pop("validation_json"))
    r["is_example"] = bool(r["is_example"])
    return r
