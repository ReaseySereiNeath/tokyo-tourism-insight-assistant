import sqlite3

from fastapi import APIRouter, Depends, Query

from app.analysis import stats
from app.db import rows
from app.routers.deps import db

router = APIRouter(prefix="/api/competitors", tags=["competitors"])

SORTS = {"price": "price IS NULL, price", "price_desc": "price IS NULL, price DESC",
         "duration": "duration_minutes IS NULL, duration_minutes", "business": "business, tour_name",
         "observed": "date_observed DESC"}


@router.get("")
def list_offers(q: str | None = None, language: str | None = None, area: str | None = None,
                latest_only: bool = True, sort: str = Query("business", pattern="^(" + "|".join(SORTS) + ")$"),
                conn: sqlite3.Connection = Depends(db)):
    sql = ["SELECT * FROM competitor_offers c WHERE 1=1"]
    params: list = []
    if latest_only:
        sql.append("""AND date_observed = (SELECT MAX(date_observed) FROM competitor_offers c2
                      WHERE c2.business = c.business AND c2.tour_name = c.tour_name AND c2.language = c.language)""")
    if q:
        sql.append("AND (business LIKE ? OR tour_name LIKE ? OR area LIKE ? OR notes LIKE ?)")
        params += [f"%{q}%"] * 4
    if language:
        sql.append("AND language = ?")
        params.append(language)
    if area:
        sql.append("AND area LIKE ?")
        params.append(f"%{area}%")
    sql.append(f"ORDER BY {SORTS[sort]}")
    return {
        "offers": rows(conn.execute(" ".join(sql), params)),
        "languages": [r[0] for r in conn.execute("SELECT DISTINCT language FROM competitor_offers ORDER BY 1")],
        "summary": stats.competitor_summary(conn),
    }


@router.get("/history")
def price_history(business: str, tour_name: str, language: str, conn: sqlite3.Connection = Depends(db)):
    return rows(conn.execute(
        "SELECT evidence_id, date_observed, price, currency, duration_minutes FROM competitor_offers "
        "WHERE business = ? AND tour_name = ? AND language = ? ORDER BY date_observed",
        (business, tour_name, language)))
