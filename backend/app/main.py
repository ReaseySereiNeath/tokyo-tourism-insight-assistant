"""FastAPI application entry point.

Run (from backend/):  uvicorn app.main:app --reload --port 8000
API docs:             http://localhost:8000/docs
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import updates
from app.config import get_settings
from app.routers import (competitors, evidence, feedback, imports, overview, profile, reports, spending,
                         updates as updates_router, visitors)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    updates.start_scheduler(get_settings().auto_update_hours)
    yield


app = FastAPI(title="Tokyo Tourism Insight Assistant", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in get_settings().cors_origins.split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)

for module in (overview, visitors, spending, competitors, feedback, imports, evidence, reports, profile,
               updates_router):
    app.include_router(module.router)


@app.post("/api/demo/reset", tags=["demo"])
def reset_demo():
    """Rebuild the synthetic demo database. Never touches real data."""
    from app.seed import seed
    seed(reset=True)
    return {"status": "ok"}
