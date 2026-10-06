import sqlite3
import threading

from fastapi import APIRouter, HTTPException

from app.db import connect
from app import updates

router = APIRouter(prefix="/api/updates", tags=["official data updates"])


@router.get("")
def status():
    """When each source was last checked, what was found, and the newest periods held."""
    conn = connect("real")
    try:
        return updates.status(conn)
    finally:
        conn.close()


@router.post("/check", status_code=202)
def check_now():
    """Start a check in the background (it may download several files). Poll GET /api/updates."""
    if updates._lock.locked():
        raise HTTPException(409, "A check is already running.")

    def run():
        try:
            updates.check_all()
        except updates.UpdateError:
            pass

    threading.Thread(target=run, name="update-check-now", daemon=True).start()
    return {"started": True}
