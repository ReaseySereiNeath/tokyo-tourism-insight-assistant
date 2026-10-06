import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query

from app.ai.classify import classify_feedback_llm
from app.ai.provider import ProviderError, get_provider
from app.analysis import stats
from app.analysis.themes import THEMES, classify_with_keywords
from app.config import get_settings
from app.db import Scope, rows
from app.routers.deps import db, scope_param

router = APIRouter(prefix="/api/feedback", tags=["feedback"])


@router.get("/themes")
def themes(method: str | None = Query(None, pattern="^(keyword|llm|local)$"), conn: sqlite3.Connection = Depends(db)):
    summary = stats.theme_summary(conn, method=method, examples_per_theme=3)
    summary["taxonomy"] = THEMES
    summary["available_methods"] = [r[0] for r in conn.execute("SELECT DISTINCT method FROM feedback_themes")]
    return summary


@router.get("")
def list_feedback(theme: str | None = None, method: str = Query("keyword", pattern="^(keyword|llm|local)$"),
                  q: str | None = None, limit: int = Query(100, le=500), conn: sqlite3.Connection = Depends(db)):
    sql = ["SELECT f.* FROM feedback f WHERE 1=1"]
    params: list = []
    if theme:
        sql.append("AND f.evidence_id IN (SELECT evidence_id FROM feedback_themes WHERE theme = ? AND method = ?)")
        params += [theme, method]
    if q:
        sql.append("AND f.text LIKE ?")
        params.append(f"%{q}%")
    sql.append("ORDER BY f.collection_date DESC, f.evidence_id LIMIT ?")
    params.append(limit)
    return rows(conn.execute(" ".join(sql), params))


@router.post("/classify")
def classify(method: str = Query("keyword", pattern="^(keyword|llm|local)$"), scope: Scope = Depends(scope_param),
             conn: sqlite3.Connection = Depends(db)):
    if method == "keyword":
        return classify_with_keywords(conn)
    if method == "local":
        try:
            from app.local_model.predict import ModelMissing, classify_feedback_local
        except ImportError as exc:
            raise HTTPException(400, "The local model needs extra packages: pip install -r requirements-ml.txt") from exc
        try:
            return classify_feedback_local(conn)
        except ModelMissing as exc:
            raise HTTPException(400, str(exc)) from exc
    settings = get_settings()
    try:
        provider = get_provider(scope, "anthropic", settings)
    except ProviderError as exc:
        raise HTTPException(400, exc.message) from exc
    return classify_feedback_llm(conn, provider, settings)
