"""Small, strict parsing helpers shared by all importers.

Principles:
- Blank means *missing*, returned as None. It is never silently turned into 0.
- Ambiguous input (e.g. "03/04/2025": March 4 or April 3?) is rejected with a
  clear message instead of being guessed.
"""
import hashlib
import re
import unicodedata
from datetime import date, datetime

MONTH_NAMES = {
    m.lower(): i
    for i, names in enumerate(
        [("jan", "january"), ("feb", "february"), ("mar", "march"), ("apr", "april"),
         ("may",), ("jun", "june"), ("jul", "july"), ("aug", "august"),
         ("sep", "sept", "september"), ("oct", "october"), ("nov", "november"), ("dec", "december")],
        start=1,
    )
    for m in names
}


class ParseError(ValueError):
    """A value that could not be interpreted; the message is shown to the user."""


def is_blank(value) -> bool:
    if value is None:
        return True
    if isinstance(value, float) and value != value:  # NaN
        return True
    return isinstance(value, str) and value.strip() == ""


def clean_text(value) -> str | None:
    """Normalize Unicode (full-width -> half-width where sensible) and trim whitespace."""
    if is_blank(value):
        return None
    text = unicodedata.normalize("NFKC", str(value))
    return re.sub(r"\s+", " ", text).strip() or None


def parse_month(value) -> str:
    """Return 'YYYY-MM'. Accepts 2025-01, 2025/1, 2025-01-01, Jan 2025, January 2025, Excel dates."""
    if is_blank(value):
        raise ParseError("is required (expected a month like 2025-01)")
    if isinstance(value, (datetime, date)):
        return f"{value.year:04d}-{value.month:02d}"
    text = clean_text(value)
    m = re.fullmatch(r"(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?(?:[ T]00:00:00)?", text)
    if m:
        year, month = int(m.group(1)), int(m.group(2))
    else:
        m = re.fullmatch(r"([A-Za-z]+)\.?[ -](\d{4})", text)
        if not m or m.group(1).lower() not in MONTH_NAMES:
            raise ParseError(f"'{text}' is not a recognized month (use YYYY-MM, e.g. 2025-01)")
        year, month = int(m.group(2)), MONTH_NAMES[m.group(1).lower()]
    if not 1 <= month <= 12:
        raise ParseError(f"'{text}' has an invalid month number")
    if not 1990 <= year <= 2100:
        raise ParseError(f"'{text}' has an implausible year")
    return f"{year:04d}-{month:02d}"


def parse_date(value, *, required: bool = True) -> str | None:
    """Return 'YYYY-MM-DD'. Only year-first formats are accepted, to avoid day/month ambiguity."""
    if is_blank(value):
        if required:
            raise ParseError("is required (expected a date like 2025-01-31)")
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = clean_text(value)
    m = re.fullmatch(r"(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?", text)
    if not m:
        if re.fullmatch(r"\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}", text):
            raise ParseError(f"'{text}' is ambiguous (day/month order); use YYYY-MM-DD")
        raise ParseError(f"'{text}' is not a valid date (use YYYY-MM-DD)")
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat()
    except ValueError as exc:
        raise ParseError(f"'{text}' is not a real calendar date") from exc


def parse_number(value, *, required: bool = False, allow_negative: bool = False) -> float | None:
    """Parse '12,500', '¥12,500', '12500円'. Blank -> None (missing), never 0."""
    if is_blank(value):
        if required:
            raise ParseError("is required (expected a number)")
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    else:
        text = clean_text(value)
        stripped = re.sub(r"[,\s¥$€£円]|JPY|USD|EUR", "", text, flags=re.IGNORECASE)
        try:
            number = float(stripped)
        except ValueError as exc:
            raise ParseError(f"'{text}' is not a number") from exc
    if number != number or number in (float("inf"), float("-inf")):
        raise ParseError("is not a finite number")
    if number < 0 and not allow_negative:
        raise ParseError(f"'{value}' must not be negative")
    return number


def parse_duration_minutes(value) -> float | None:
    """Parse durations into minutes: '180', '3h', '3 hours', '2.5h', '3h30m', '90 min', '3:30'."""
    if is_blank(value):
        return None
    if isinstance(value, (int, float)):
        return parse_number(value)
    text = clean_text(value).lower()
    if re.fullmatch(r"\d+(\.\d+)?", text):
        return float(text)
    m = re.fullmatch(r"(\d+):(\d{2})", text)
    if m:
        return int(m.group(1)) * 60 + int(m.group(2))
    m = re.fullmatch(
        r"(?:(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours))?\s*(?:(\d+)\s*(?:m|min|mins|minute|minutes))?", text
    )
    if m and (m.group(1) or m.group(2)):
        return float(m.group(1) or 0) * 60 + float(m.group(2) or 0)
    raise ParseError(f"'{value}' is not a recognized duration (e.g. 180, 3h, 3h30m, 90 min)")


def make_evidence_id(prefix: str, key_parts: list, scope: str) -> str:
    """Stable ID derived from a record's natural key.

    The same record always gets the same ID, which is what makes re-importing
    a file harmless. Demo records get a visible DEMO- prefix.
    """
    normalized = "|".join((clean_text(p) or "").lower() for p in key_parts)
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:12].upper()
    return f"{'DEMO-' if scope == 'demo' else ''}{prefix}-{digest}"


def normalize_url(url: str | None) -> str | None:
    url = clean_text(url)
    if not url:
        return None
    if not re.match(r"https?://", url, flags=re.IGNORECASE):
        raise ParseError(f"'{url}' must start with http:// or https://")
    return url.rstrip("/")
