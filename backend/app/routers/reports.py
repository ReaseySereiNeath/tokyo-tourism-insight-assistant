import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query

from app.ai.evidence import build_evidence_pack
from app.ai.provider import ProviderError, get_provider
from app.ai.report import generate_report, load_report
from app.config import get_settings
from app.db import Scope, rows
from app.routers.deps import db, scope_param

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/preview")
def preview(scope: Scope = Depends(scope_param), conn: sqlite3.Connection = Depends(db)):
    """The exact evidence a report would receive. Works without an API key."""
    return build_evidence_pack(conn, scope, get_settings())


@router.post("")
def create(provider: str | None = Query(None, pattern="^(anthropic|local|demo)$"), scope: Scope = Depends(scope_param),
           conn: sqlite3.Connection = Depends(db)):
    settings = get_settings()
    try:
        chosen = get_provider(scope, provider, settings)
    except ProviderError as exc:
        raise HTTPException(400, exc.message) from exc
    report_id = generate_report(conn, scope, chosen, settings)
    return load_report(conn, report_id)


@router.get("")
def list_reports(conn: sqlite3.Connection = Depends(db)):
    return rows(conn.execute(
        "SELECT id, created_at, provider, model, is_example, status, error FROM reports ORDER BY id DESC LIMIT 50"))


@router.get("/{report_id}")
def get(report_id: int, conn: sqlite3.Connection = Depends(db)):
    report = load_report(conn, report_id)
    if report is None:
        raise HTTPException(404, "Report not found")
    return report
