"""Dataset definitions: columns, validation, natural keys.

Each dataset declares:
- columns: what the import template contains (required + optional)
- normalize(row): turns one raw row into a clean record or raises ParseError
- key_fields: the natural key used to build the stable evidence ID
- mutable_fields: fields a re-import may legitimately revise (e.g. an
  'estimate' statistic later published as 'final'). Any other difference
  produces a new record because the key changed.
"""
import re
from collections.abc import Callable
from dataclasses import dataclass, field

from app.importers.common import (
    ParseError,
    clean_text,
    normalize_url,
    parse_date,
    parse_duration_minutes,
    parse_month,
    parse_number,
)


@dataclass(frozen=True)
class Column:
    name: str
    required: bool
    description: str
    example: str
    aliases: tuple[str, ...] = ()


@dataclass(frozen=True)
class Dataset:
    name: str
    label: str
    table: str
    id_prefix: str
    columns: list[Column]
    key_fields: list[str]
    mutable_fields: list[str]
    normalize: Callable[[dict], dict]
    notes: list[str] = field(default_factory=list)

    @property
    def required_columns(self) -> list[str]:
        return [c.name for c in self.columns if c.required]


def _required_text(row: dict, col: str) -> str:
    value = clean_text(row.get(col))
    if value is None:
        raise ParseError(f"{col} is required")
    return value


def _wrap(col: str, fn, *args, **kwargs):
    """Run a parser and prefix any error with the column name."""
    try:
        return fn(*args, **kwargs)
    except ParseError as exc:
        msg = str(exc)
        raise ParseError(msg if msg.startswith(col) else f"{col} {msg}") from None


VALUE_STATUSES = {"final", "provisional", "estimate", "unknown"}
ORIGIN_LEVELS = {"total", "region", "country", "subregion", "other"}


def normalize_visitor_stat(row: dict) -> dict:
    status = (clean_text(row.get("value_status")) or "unknown").lower()
    if status not in VALUE_STATUSES:
        raise ParseError(f"value_status must be one of {sorted(VALUE_STATUSES)}")
    level = (clean_text(row.get("origin_level")) or "country").lower()
    if level not in ORIGIN_LEVELS:
        raise ParseError(f"origin_level must be one of {sorted(ORIGIN_LEVELS)}")
    return {
        "reporting_month": _wrap("reporting_month", parse_month, row.get("reporting_month")),
        "geography": _required_text(row, "geography"),
        "visitor_origin": _required_text(row, "visitor_origin"),
        "origin_level": level,
        "metric": _required_text(row, "metric").lower().replace(" ", "_"),
        "value": _wrap("value", parse_number, row.get("value"), required=True),
        "unit": _required_text(row, "unit").lower(),
        "value_status": status,
        "source": _required_text(row, "source"),
        "original_label": clean_text(row.get("original_label")),
        "publication_date": _wrap("publication_date", parse_date, row.get("publication_date"), required=False),
        "collection_date": _wrap("collection_date", parse_date, row.get("collection_date")),
    }


SPENDING_STATUSES = {"final", "preliminary", "unknown"}


def normalize_spending_stat(row: dict) -> dict:
    status = (clean_text(row.get("value_status")) or "unknown").lower()
    if status not in SPENDING_STATUSES:
        raise ParseError(f"value_status must be one of {sorted(SPENDING_STATUSES)}")
    period = _required_text(row, "reporting_period")
    if not re.fullmatch(r"\d{4}(-Q[1-4])?", period):
        raise ParseError("reporting_period must look like 2026-Q2 (a quarter) or 2026 (a calendar year)")
    respondents = _wrap("respondents", parse_number, row.get("respondents"))
    return {
        "reporting_period": period,
        "period_type": "quarter" if "-Q" in period else "year",
        "geography": _required_text(row, "geography"),
        "segment": clean_text(row.get("segment")) or "All nationalities",
        "purpose": (clean_text(row.get("purpose")) or "all").lower(),
        "category": _required_text(row, "category").lower().replace(" ", "_"),
        "item": (clean_text(row.get("item")) or "").lower().replace(" ", "_"),
        "metric": _required_text(row, "metric").lower().replace(" ", "_"),
        "value": _wrap("value", parse_number, row.get("value"), required=True),
        "unit": _required_text(row, "unit"),
        "respondents": None if respondents is None else int(respondents),
        "value_status": status,
        "source": _required_text(row, "source"),
        "original_label": clean_text(row.get("original_label")),
        "publication_date": _wrap("publication_date", parse_date, row.get("publication_date"), required=False),
        "collection_date": _wrap("collection_date", parse_date, row.get("collection_date")),
    }


def normalize_competitor_offer(row: dict) -> dict:
    price = _wrap("price", parse_number, row.get("price"))
    currency = (clean_text(row.get("currency")) or "").upper() or None
    if price is not None and not currency:
        raise ParseError("currency is required when price is given (e.g. JPY)")
    return {
        "business": _required_text(row, "business"),
        "tour_name": _required_text(row, "tour_name"),
        "area": clean_text(row.get("area")),
        "price": price,
        "currency": currency,
        "duration_minutes": _wrap("duration", parse_duration_minutes, row.get("duration")),
        "language": _required_text(row, "language"),
        "url": _wrap("url", normalize_url, row.get("url")),
        "date_observed": _wrap("date_observed", parse_date, row.get("date_observed")),
        "notes": clean_text(row.get("notes")),
        "source": clean_text(row.get("source")) or "manual entry",
    }


def normalize_feedback(row: dict) -> dict:
    text = _required_text(row, "text")
    if len(text) < 3:
        raise ParseError("text is too short to be useful feedback")
    rating = _wrap("rating", parse_number, row.get("rating"))
    if rating is not None and rating > 10:
        raise ParseError("rating looks out of range (expected e.g. 1-5 or 1-10)")
    return {
        "text": text,
        "language": _required_text(row, "language"),
        "source": _required_text(row, "source"),
        "rating": rating,
        "permission_basis": _required_text(row, "permission_basis"),
        "publication_date": _wrap("publication_date", parse_date, row.get("publication_date"), required=False),
        "collection_date": _wrap("collection_date", parse_date, row.get("collection_date")),
    }


def normalize_news(row: dict) -> dict:
    return {
        "title": _required_text(row, "title"),
        "excerpt": clean_text(row.get("excerpt")),
        "url": _wrap("url", normalize_url, row.get("url")),
        "publisher": _required_text(row, "publisher"),
        "publication_date": _wrap("publication_date", parse_date, row.get("publication_date"), required=False),
        "collection_date": _wrap("collection_date", parse_date, row.get("collection_date")),
        "source_type": "manual",
    }


DATASETS: dict[str, Dataset] = {
    "visitor_stats": Dataset(
        name="visitor_stats",
        label="Visitor statistics",
        table="visitor_stats",
        id_prefix="VS",
        columns=[
            Column("reporting_month", True, "Month the figure describes", "2025-01"),
            Column("geography", True, "Where visitors were counted. Keep 'Japan' (national arrivals) and 'Tokyo' separate", "Japan"),
            Column("visitor_origin", True, "Country/region of residence or nationality, as the source defines it", "United States"),
            Column("origin_level", False, "total | region | country | subregion | other (default: country)", "country"),
            Column("metric", True, "What is counted", "visitor_arrivals"),
            Column("value", True, "The number. Leave the row out if the value is not published", "182556"),
            Column("unit", True, "Unit of the value", "persons"),
            Column("value_status", False, "final | provisional | estimate | unknown", "final"),
            Column("source", True, "Who published it", "JNTO"),
            Column("original_label", False, "Label as written in the source", "米国"),
            Column("publication_date", False, "When the source published it (YYYY-MM-DD)", "2025-02-19"),
            Column("collection_date", True, "When you downloaded it (YYYY-MM-DD)", "2025-03-01"),
        ],
        key_fields=["source", "geography", "visitor_origin", "metric", "unit", "reporting_month"],
        mutable_fields=["value", "value_status", "origin_level", "original_label", "publication_date"],
        normalize=normalize_visitor_stat,
        notes=[
            "Japan-wide arrivals (JNTO) and Tokyo visitor counts are different populations; never sum or compare them as one series.",
            "Nationality does not tell you which tour language a visitor wants.",
        ],
    ),
    "spending_stats": Dataset(
        name="spending_stats",
        label="Visitor spending",
        table="spending_stats",
        id_prefix="SP",
        columns=[
            Column("reporting_period", True, "Quarter (2026-Q2) or calendar year (2026) the figure describes", "2026-Q2"),
            Column("geography", True, "'Japan' for national tables, or a prefecture such as 'Tokyo'", "Tokyo"),
            Column("segment", False, "Visitor group, e.g. a nationality (default: All nationalities)", "All nationalities"),
            Column("purpose", False, "all | leisure (default: all)", "all"),
            Column("category", True, "Spending category", "entertainment"),
            Column("item", False, "Item within the category, blank for the category itself", "local_tours_guides"),
            Column("metric", True, "spend_per_person | purchase_rate | spend_per_purchaser | total_spend | visitors", "spend_per_person"),
            Column("value", True, "The number, in base units (yen, persons, percent)", "2226.7"),
            Column("unit", True, "Unit of the value", "JPY per person"),
            Column("respondents", False, "Survey respondents behind the figure", "7896"),
            Column("value_status", False, "final | preliminary | unknown", "preliminary"),
            Column("source", True, "Who published it", "JTA"),
            Column("original_label", False, "Label as written in the source", "現地ツアー・観光ガイド"),
            Column("publication_date", False, "When the source published it (YYYY-MM-DD)", "2026-09-30"),
            Column("collection_date", True, "When you downloaded it (YYYY-MM-DD)", "2026-10-06"),
        ],
        key_fields=["source", "geography", "segment", "purpose", "category", "item", "metric", "reporting_period"],
        mutable_fields=["value", "unit", "respondents", "value_status", "original_label", "publication_date"],
        normalize=normalize_spending_stat,
        notes=[
            "Use 'Japan Tourism Agency spending workbook' as the file type to import the official files unchanged.",
            "These are survey estimates. Figures for small visitor groups rest on few respondents.",
        ],
    ),
    "competitor_offers": Dataset(
        name="competitor_offers",
        label="Competitor offers",
        table="competitor_offers",
        id_prefix="CO",
        columns=[
            Column("business", True, "Competitor business name", "Example Tours Co."),
            Column("tour_name", True, "Name of the tour", "Shibuya Night Food Walk"),
            Column("area", False, "Neighbourhood(s) covered", "Shibuya"),
            Column("price", False, "Price per adult. Leave blank if not published (not 0)", "12000"),
            Column("currency", False, "Required when price is given", "JPY"),
            Column("duration", False, "Minutes, or text like 3h, 2.5 hours, 3h30m", "3h"),
            Column("language", True, "Tour language", "English"),
            Column("url", False, "Public listing URL", "https://example.com/tour"),
            Column("date_observed", True, "When you saw this offer (YYYY-MM-DD)", "2025-03-01"),
            Column("notes", False, "Anything notable (group size, inclusions)", "Max 8 guests, 6 tastings"),
            Column("source", False, "Where you saw it (default: manual entry)", "Company website"),
        ],
        key_fields=["business", "tour_name", "language", "date_observed"],
        mutable_fields=["area", "price", "currency", "duration_minutes", "url", "notes", "source"],
        normalize=normalize_competitor_offer,
        notes=["The same offer observed on a different date is kept as a new observation (price history)."],
    ),
    "feedback": Dataset(
        name="feedback",
        label="Customer feedback",
        table="feedback",
        id_prefix="FB",
        columns=[
            Column("text", True, "Original feedback text, unedited", "The guide was great but we walked too fast."),
            Column("language", True, "Language of the text (e.g. en, ja)", "en"),
            Column("source", True, "Where the feedback came from", "Post-tour survey"),
            Column("rating", False, "Rating if given (e.g. 1-5)", "4"),
            Column("permission_basis", True, "Why you may use it (consent, own survey, licence)", "Own post-tour survey, consent given"),
            Column("publication_date", False, "When it was published, if known (YYYY-MM-DD)", "2025-02-10"),
            Column("collection_date", True, "When you collected it (YYYY-MM-DD)", "2025-03-01"),
        ],
        key_fields=["source", "text", "publication_date"],
        mutable_fields=["language", "rating", "permission_basis"],
        normalize=normalize_feedback,
        notes=["Only import feedback you have permission to use. Personal data such as names or emails should be removed first."],
    ),
    "news": Dataset(
        name="news",
        label="News",
        table="news",
        id_prefix="NW",
        columns=[
            Column("title", True, "Headline", "Tokyo extends tourist information centre hours"),
            Column("excerpt", False, "Short excerpt you are permitted to store", "The centre will open until 21:00..."),
            Column("url", False, "Link to the article", "https://example.com/news/1"),
            Column("publisher", True, "Publisher name", "Example News"),
            Column("publication_date", False, "When it was published (YYYY-MM-DD)", "2025-02-10"),
            Column("collection_date", True, "When you collected it (YYYY-MM-DD)", "2025-03-01"),
        ],
        key_fields=["url", "title", "publisher"],
        mutable_fields=["excerpt", "publication_date"],
        normalize=normalize_news,
        notes=["Store only headlines and short excerpts you are permitted to keep; do not paste full paywalled articles."],
    ),
}
