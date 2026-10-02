import json
import sqlite3

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.ai.evidence import load_profile
from app.db import utcnow
from app.routers.deps import db

router = APIRouter(prefix="/api/profile", tags=["business profile"])


class BusinessProfile(BaseModel):
    business_name: str = Field("", max_length=200)
    offerings: str = Field("", max_length=2000)
    operating_area: str = Field("", max_length=500)
    capacity: str = Field("", max_length=500)
    price_range: str = Field("", max_length=300)
    monthly_budget: str = Field("", max_length=300)
    goals: str = Field("", max_length=2000)
    notes: str = Field("", max_length=2000)


@router.get("")
def get_profile(conn: sqlite3.Connection = Depends(db)):
    return BusinessProfile(**load_profile(conn))


@router.put("")
def put_profile(profile: BusinessProfile, conn: sqlite3.Connection = Depends(db)):
    conn.execute("INSERT INTO business_profile (id, data_json, updated_at) VALUES (1, ?, ?) "
                 "ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at",
                 (json.dumps(profile.model_dump(), ensure_ascii=False), utcnow()))
    conn.commit()
    return profile
