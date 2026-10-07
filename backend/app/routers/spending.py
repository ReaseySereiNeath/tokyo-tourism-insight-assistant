import sqlite3

from fastapi import APIRouter, Depends, Query

from app.analysis import spending
from app.routers.deps import db

router = APIRouter(prefix="/api/spending", tags=["visitor spending"])

PERIOD = r"^\d{4}(-Q[1-4])?$"


@router.get("/periods")
def periods(conn: sqlite3.Connection = Depends(db)):
    return spending.periods(conn)


@router.get("/market")
def market(geography: str = "Tokyo", period: str | None = Query(None, pattern=PERIOD),
           conn: sqlite3.Connection = Depends(db)):
    """Total visitor spending by category in one prefecture."""
    return spending.market(conn, geography, period)


@router.get("/items")
def items(segment: str = "All nationalities", period: str | None = Query(None, pattern=PERIOD),
          conn: sqlite3.Connection = Depends(db)):
    """Spend per visitor on every category and item, nationally."""
    return spending.items(conn, segment, period)


@router.get("/segments")
def segments(category: str, item: str = "", period: str | None = Query(None, pattern=PERIOD),
             conn: sqlite3.Connection = Depends(db)):
    """Which nationalities buy one item, and how fast their arrivals are growing."""
    return spending.segments_for_item(conn, category, item, period)


@router.get("/segment-names")
def segment_names(conn: sqlite3.Connection = Depends(db)):
    return [r[0] for r in conn.execute(
        f"SELECT DISTINCT segment FROM spending_stats WHERE {spending.CURRENT} AND geography = 'Japan' "
        "ORDER BY segment != 'All nationalities', segment")]


@router.get("/history")
def history(segment: str = "All nationalities", conn: sqlite3.Connection = Depends(db)):
    """Category spending per visitor since 2010, one series per survey design (never joined)."""
    return spending.history(conn, segment)
