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


class Insight(BaseModel):
    finding: str = Field(min_length=10, description="What the evidence shows, stated plainly. Numbers only if they appear in the facts.")
    evidence_ids: list[str] = Field(min_length=1, max_length=15, description="IDs of facts (F1, F2...) or records (VS-, CO-, FB-, NW-) that support the finding.")
    interpretation: str = Field(min_length=10, description="What this might mean for the business owner's tours.")
    customer_segment: str | None = Field(description="Visitor segment ONLY if the evidence supports it; otherwise null.")
    segment_support: str | None = Field(description="Why the evidence supports that segment; null when customer_segment is null.")
    proposed_experiment: str = Field(min_length=10, description="A small, reversible test that fits the business profile and budget.")
    success_measure: str = Field(min_length=5, description="Concrete, measurable signal and threshold to judge the experiment.")
    limitations: list[str] = Field(min_length=1, max_length=6)
    alternative_explanations: list[str] = Field(min_length=1, max_length=6)
    confidence: Literal["low", "medium", "high"]


class ReportOutput(BaseModel):
    summary: str = Field(min_length=10, description="Three to five sentences for the business owner.")
    data_sufficiency: Literal["sufficient", "limited", "insufficient"]
    sufficiency_notes: list[str] = Field(max_length=8, description="What data is missing or weak, and how that limits conclusions.")
    insights: list[Insight] = Field(max_length=8)
    customer_needs_to_investigate: list[str] = Field(max_length=8, description="Open questions about visitor needs worth researching further.")


class FeedbackLabel(BaseModel):
    evidence_id: str
    themes: list[ThemeName] = Field(min_length=1, max_length=4)
    sentiment: Literal["positive", "negative", "mixed", "neutral"]


class ClassificationOutput(BaseModel):
    labels: list[FeedbackLabel]
