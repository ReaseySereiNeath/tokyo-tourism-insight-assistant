"""Structured output contracts for the language model.

These Pydantic models serve two purposes:
1. they are converted to JSON Schema and sent to the API (structured outputs), and
2. every response is re-validated against them here, because a schema sent to a
   remote service is a request, not a guarantee we can rely on blindly.
"""
from typing import Literal

from pydantic import BaseModel, Field

from app.analysis.themes import THEMES

ThemeName = Literal[tuple(THEMES)]  # type: ignore[valid-type]


BusinessType = Literal["tours_activities", "food_drink", "accommodation", "retail_shopping",
                       "transport_mobility", "wellness_beauty", "events_entertainment", "services_other"]


class Opportunity(BaseModel):
    business_idea: str = Field(min_length=5, max_length=120, description="A short name for the business, e.g. 'Small-group sake tasting evenings'.")
    business_type: BusinessType
    demand_evidence: str = Field(min_length=10, description="What the data shows about demand. Numbers only as stated in the facts.")
    evidence_ids: list[str] = Field(min_length=1, max_length=15, description="IDs of facts (F1, F2...) or records (VS-, SP-, CO-, FB-, NW-) that support the demand evidence.")
    why_it_could_work: str = Field(min_length=10, description="Why this could suit this person, using their profile (budget, skills, languages, time).")
    target_visitors: str | None = Field(description="Visitor group to aim at ONLY if the evidence supports it; otherwise null.")
    target_support: str | None = Field(description="Which evidence supports that visitor group; null when target_visitors is null.")
    first_test: str = Field(min_length=10, description="A small, cheap way to test demand before committing money, within the person's budget.")
    success_measure: str = Field(min_length=5, description="A concrete, measurable signal and threshold that would justify going further.")
    checks_before_starting: list[str] = Field(min_length=1, max_length=8, description="What to verify first: competition, permits or licences to ask about, start-up costs, location. Name what to check; do not state legal requirements as fact.")
    risks: list[str] = Field(min_length=1, max_length=6, description="Weaknesses in the evidence and business risks.")
    alternative_explanations: list[str] = Field(min_length=1, max_length=6, description="Other reasons the data could look like this.")
    confidence: Literal["low", "medium", "high"]


class ReportOutput(BaseModel):
    summary: str = Field(min_length=10, description="Three to five sentences for the person choosing a business.")
    data_sufficiency: Literal["sufficient", "limited", "insufficient"]
    sufficiency_notes: list[str] = Field(max_length=8, description="What data is missing or weak, and how that limits conclusions.")
    opportunities: list[Opportunity] = Field(max_length=8, description="Ranked best first.")
    questions_to_research: list[str] = Field(max_length=8, description="Open questions worth answering before choosing, e.g. by talking to visitors or businesses.")


class FeedbackLabel(BaseModel):
    evidence_id: str
    themes: list[ThemeName] = Field(min_length=1, max_length=4)
    sentiment: Literal["positive", "negative", "mixed", "neutral"]


class ClassificationOutput(BaseModel):
    labels: list[FeedbackLabel]
