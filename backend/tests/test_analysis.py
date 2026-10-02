from app.analysis.stats import competitor_summary, monthly_series, origin_comparison, pct_change, share
from app.importers.service import run_import

VS_HEADER = "reporting_month,geography,visitor_origin,origin_level,metric,value,unit,source,collection_date\n"


def test_pct_change_handles_missing_and_zero():
    assert pct_change(110, 100) == {"value": 10.0, "status": "ok"}
    assert pct_change(None, 100)["status"] == "missing_current"
    assert pct_change(100, None)["status"] == "missing_previous"
    assert pct_change(5, 0) == {"value": None, "status": "zero_base"}


def test_share_never_divides_by_zero():
    assert share(1, 0) is None
    assert share(None, 10) is None
    assert share(1, 4) == 25.0


def _load(conn, lines):
    batch = run_import(conn, "real", "visitor_stats", "s.csv", (VS_HEADER + "".join(lines)).encode())
    assert batch["status"] == "success", batch["errors"]


def row(month, value, origin="United States", level="country", geo="Japan"):
    return f"{month},{geo},{origin},{level},visitor_arrivals,{value},persons,JNTO,2025-01-01\n"


def test_missing_month_is_a_gap_and_blocks_mom(real_conn):
    _load(real_conn, [row("2024-01", 100), row("2024-03", 130)])  # February missing
    s = monthly_series(real_conn, "Japan", "visitor_arrivals", "persons", "JNTO", ["United States"])
    points = {p["month"]: p for p in s["series"][0]["points"]}
    assert points["2024-02"]["value"] is None                  # gap, not zero
    assert points["2024-03"]["mom"]["status"] == "missing_previous"
    assert s["series"][0]["months_missing"] == 1


def test_yoy_only_with_same_month_last_year(real_conn):
    _load(real_conn, [row("2024-01", 100), row("2025-01", 150), row("2025-02", 160)])
    s = monthly_series(real_conn, "Japan", "visitor_arrivals", "persons", "JNTO", ["United States"], start="2025-01")
    points = {p["month"]: p for p in s["series"][0]["points"]}
    assert points["2025-01"]["yoy"] == {"value": 50.0, "status": "ok"}
    assert points["2025-02"]["yoy"]["status"] == "missing_previous"
    assert s["months"] == ["2025-01", "2025-02"]  # the extra year is loaded for YoY but not displayed


def test_series_never_mix_geographies(real_conn):
    _load(real_conn, [row("2025-01", 100), row("2025-01", 40, geo="Tokyo")])
    s = monthly_series(real_conn, "Japan", "visitor_arrivals", "persons", "JNTO", ["United States"])
    assert [p["value"] for p in s["series"][0]["points"]] == [100]


def test_origin_comparison_shares_and_zero_base(real_conn):
    _load(real_conn, [row("2024-01", 0), row("2025-01", 50),
                      row("2024-01", 500, "All origins", "total"), row("2025-01", 1000, "All origins", "total")])
    cmp = origin_comparison(real_conn, "Japan", "visitor_arrivals", "persons", "JNTO")
    us = cmp["rows"][0]
    assert us["share_of_total_pct"] == 5.0
    assert us["yoy"]["status"] == "zero_base"


def test_competitor_summary_excludes_missing_prices_and_reports_n(real_conn):
    header = "business,tour_name,price,currency,duration,language,date_observed\n"
    csv = header + "A,Walk,10000,JPY,3h,English,2025-01-01\nB,Food,,,2h,English,2025-01-01\nC,Night,14000,JPY,,English,2025-01-01\n"
    run_import(real_conn, "real", "competitor_offers", "o.csv", csv.encode())
    s = competitor_summary(real_conn)
    jpy = s["by_currency"][0]
    assert (jpy["n"], jpy["median"], s["missing_price"]) == (2, 12000.0, 1)
    assert s["duration_n"] == 2


def test_competitor_summary_uses_latest_observation(real_conn):
    header = "business,tour_name,price,currency,language,date_observed\n"
    csv = header + "A,Walk,10000,JPY,English,2025-01-01\nA,Walk,12000,JPY,English,2025-03-01\n"
    run_import(real_conn, "real", "competitor_offers", "o.csv", csv.encode())
    s = competitor_summary(real_conn)
    assert (s["observations"], s["offers"], s["by_currency"][0]["median"]) == (2, 1, 12000.0)
