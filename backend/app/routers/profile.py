import json
import sqlite3

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.ai.evidence import load_profile
from app.db import utcnow
from app.routers.deps import db

router = APIRouter(prefix="/api/profile", tags=["about you"])


class FounderProfile(BaseModel):
    """About the person choosing a business. Every field is optional free text."""
    budget: str = Field("", max_length=300)          # money available to start
    time_available: str = Field("", max_length=300)  # side project or full time, hours per week
    location: str = Field("", max_length=300)        # where they can operate
    languages: str = Field("", max_length=300)
    skills: str = Field("", max_length=2000)         # experience, qualifications, hobbies that count
    interests: str = Field("", max_length=2000)      # kinds of business they would consider
    limits: str = Field("", max_length=2000)         # visa, family, risk tolerance, things they won't do
    goals: str = Field("", max_length=2000)          # income target, timeline, what success looks like


@router.get("")
def get_profile(conn: sqlite3.Connection = Depends(db)):
    return FounderProfile(**load_profile(conn))


@router.put("")
def put_profile(profile: FounderProfile, conn: sqlite3.Connection = Depends(db)):
    conn.execute("INSERT INTO business_profile (id, data_json, updated_at) VALUES (1, ?, ?) "
                 "ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at",
                 (json.dumps(profile.model_dump(), ensure_ascii=False), utcnow()))
    conn.commit()
    return profile
