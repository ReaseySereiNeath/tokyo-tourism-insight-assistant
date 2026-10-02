import pytest

from app.importers.common import (ParseError, make_evidence_id, parse_date, parse_duration_minutes, parse_month,
                                  parse_number)


@pytest.mark.parametrize("raw,expected", [
    ("2025-01", "2025-01"), ("2025/1", "2025-01"), ("2025-01-15", "2025-01"),
    ("Jan 2025", "2025-01"), ("September 2024", "2024-09"), ("２０２５－０３", "2025-03"),  # full-width digits
])
def test_parse_month_accepts_unambiguous_formats(raw, expected):
    assert parse_month(raw) == expected


@pytest.mark.parametrize("raw", ["", "2025-13", "13/2025", "last month", "1890-01"])
def test_parse_month_rejects_bad_values(raw):
    with pytest.raises(ParseError):
        parse_month(raw)


def test_parse_date_rejects_day_month_ambiguity():
    with pytest.raises(ParseError, match="ambiguous"):
        parse_date("03/04/2025")


def test_parse_date_rejects_impossible_dates():
    with pytest.raises(ParseError, match="real calendar date"):
        parse_date("2025-02-30")


def test_optional_date_blank_is_none():
    assert parse_date("  ", required=False) is None


def test_blank_number_is_missing_not_zero():
    assert parse_number("") is None
    assert parse_number(None) is None
    assert parse_number("0") == 0.0


def test_number_strips_currency_and_separators():
    assert parse_number("¥12,500") == 12500
    assert parse_number("12500円") == 12500


def test_negative_numbers_rejected_by_default():
    with pytest.raises(ParseError):
        parse_number("-5")


@pytest.mark.parametrize("raw,minutes", [("180", 180), ("3h", 180), ("2.5 hours", 150), ("3h30m", 210),
                                         ("90 min", 90), ("3:30", 210), ("", None)])
def test_durations(raw, minutes):
    assert parse_duration_minutes(raw) == minutes


def test_evidence_ids_are_stable_and_scope_labeled():
    a = make_evidence_id("FB", ["Survey", "Great tour!"], "real")
    assert a == make_evidence_id("FB", [" survey ", "great  tour!"], "real")  # whitespace/case-insensitive key
    assert a.startswith("FB-")
    assert make_evidence_id("FB", ["Survey", "Great tour!"], "demo").startswith("DEMO-FB-")
