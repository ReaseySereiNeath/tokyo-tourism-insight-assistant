import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query

from app.analysis import stats
from app.routers.deps import db

router = APIRouter(prefix="/api/visitor-stats", tags=["visitor statistics"])


@router.get("/catalog")
def catalog(conn: sqlite3.Connection = Depends(db)):
    """Available series. The UI must pick ONE geography/metric/unit/source at a time."""
    return stats.series_catalog(conn)


@router.get("/origins")
def origins(geography: str, metric: str, unit: str, source: str, conn: sqlite3.Connection = Depends(db)):
    return stats.origins_for(conn, geography, metric, unit, source)


@router.get("/series")
def series(geography: str, metric: str, unit: str, source: str,
           origins: list[str] = Query(..., max_length=12),
           start: str | None = Query(None, pattern=r"^\d{4}-\d{2}$"),
           end: str | None = Query(None, pattern=r"^\d{4}-\d{2}$"),
           conn: sqlite3.Connection = Depends(db)):
    if start and end and start > end:
        raise HTTPException(400, "start must be before end")
    return stats.monthly_series(conn, geography, metric, unit, source, origins, start, end)


@router.get("/compare")
def compare(geography: str, metric: str, unit: str, source: str,
            month: str | None = Query(None, pattern=r"^\d{4}-\d{2}$"),
            level: str = Query("country", pattern="^(total|region|country|other|all)$"),
            conn: sqlite3.Connection = Depends(db)):
    return stats.origin_comparison(conn, geography, metric, unit, source, month, level)
