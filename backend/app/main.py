"""FastAPI application entry point.

Run (from backend/):  uvicorn app.main:app --reload --port 8000
API docs:             http://localhost:8000/docs
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import competitors, evidence, feedback, imports, overview, profile, reports, visitors

app = FastAPI(title="Tokyo Tourism Insight Assistant", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in get_settings().cors_origins.split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)

for module in (overview, visitors, competitors, feedback, imports, evidence, reports, profile):
    app.include_router(module.router)


@app.post("/api/demo/reset", tags=["demo"])
def reset_demo():
    """Rebuild the synthetic demo database. Never touches real data."""
    from app.seed import seed
    seed(reset=True)
    return {"status": "ok"}
