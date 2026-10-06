import sqlite3

from fastapi import APIRouter, Depends

from app.analysis import stats
from app.config import get_settings
from app.db import Scope, rows
from app.local_model import model_dir
from app.routers.deps import db, scope_param

router = APIRouter(prefix="/api", tags=["overview"])


@router.get("/health")
def health():
    s = get_settings()
    return {"status": "ok", "ai_configured": s.ai_configured, "model": s.anthropic_model if s.ai_configured else None,
            "local_model_trained": (model_dir() / "meta.json").exists()}


@router.get("/overview")
def overview(scope: Scope = Depends(scope_param), conn: sqlite3.Connection = Depends(db)):
    themes = stats.theme_summary(conn, examples_per_theme=0)
    return {
        "scope": scope,
        "coverage": stats.coverage(conn),
        "key_trends": stats.key_trends(conn, top_n=3),
        "competitors": stats.competitor_summary(conn),
        "top_themes": themes["themes"][:5],
        "theme_method": themes["method"],
        "feedback_classified": themes["classified"],
        "feedback_total": themes["total_feedback"],
        "recent_imports": rows(conn.execute(
            "SELECT id, dataset, importer, original_filename, status, rows_inserted, rows_duplicate, rows_updated, "
            "completed_at FROM import_batches ORDER BY id DESC LIMIT 5")),
        "latest_report": next(iter(rows(conn.execute(
            "SELECT id, created_at, provider, is_example, status FROM reports ORDER BY id DESC LIMIT 1"))), None),
    }
