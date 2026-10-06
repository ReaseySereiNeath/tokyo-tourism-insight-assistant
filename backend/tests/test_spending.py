"""Visitor spending: JTA workbook parsing, analysis, and the update checker (no network)."""
import io

import httpx
import openpyxl
import pytest
from fastapi.testclient import TestClient

from app import updates
from app.analysis import spending
from app.importers.jta import parse_jta_spending_workbook
from app.importers.service import run_import
from app.main import app
from tests.jta_fixtures import JNTO_PAGE_HTML, JTA_PAGE_HTML, national_workbook, prefecture_workbook


def by_key(records):
    return {(r["segment"], r["category"], r["item"], r["metric"]): r for r in records}


# ------------------------------------------------------------ parsing

def test_national_tables_are_parsed_into_base_units():
    parsed = parse_jta_spending_workbook(national_workbook(), "n.xlsx")
    assert not parsed.errors
    r = by_key(parsed.records)
    assert parsed.records[0]["reporting_period"] == "2026-Q2"
    assert parsed.records[0]["value_status"] == "preliminary"
    tour = r[("All nationalities", "entertainment", "local_tours_guides", "spend_per_person")]
    assert tour["value"] == pytest.approx(2226.7) and tour["unit"] == "JPY per person"
    rate = r[("All nationalities", "entertainment", "local_tours_guides", "purchase_rate")]
    assert rate["value"] == pytest.approx(8.7562) and rate["respondents"] == 676
    assert r[("South Korea", "entertainment", "local_tours_guides", "spend_per_purchaser")]["value"] == pytest.approx(5521.91)
    assert r[("All nationalities", "total", "", "spend_per_person")]["value"] == pytest.approx(244733.2571)
    # Half-width katakana in the source label is normalized before matching.
    assert ("All nationalities", "entertainment", "onsen_spa_relaxation", "spend_per_person") in r


def test_blank_cells_are_missing_not_zero_and_unknown_labels_warn():
    parsed = parse_jta_spending_workbook(national_workbook(korea_tour_rate=None), "n.xlsx")
    r = by_key(parsed.records)
    assert ("South Korea", "entertainment", "local_tours_guides", "purchase_rate") not in r
    assert ("South Korea", "entertainment", "onsen_spa_relaxation", "spend_per_person") not in r
    assert any("謎の新項目" in w for w in parsed.warnings)
    assert not any(k[2] == "" and k[1] == "注）サンプル" for k in r)


def test_prefecture_tables_convert_oku_and_man_units():
    parsed = parse_jta_spending_workbook(prefecture_workbook(), "p.xlsx")
    assert not parsed.errors
    r = {(x["geography"], x["category"], x["metric"]): x for x in parsed.records}
    assert r[("Tokyo", "total", "total_spend")]["value"] == pytest.approx(9426.87 * 1e8)
    assert r[("Tokyo", "entertainment", "total_spend")]["value"] == pytest.approx(342.13 * 1e8)
    assert r[("Tokyo", "total", "visitors")]["value"] == pytest.approx(5_416_161.77, rel=1e-6)
    assert r[("Tokyo", "total", "visit_rate")]["value"] == pytest.approx(52.81877, rel=1e-6)
    assert r[("Tokyo", "total", "spend_per_person")]["value"] == pytest.approx(174_050.675, rel=1e-6)
    assert not any(x["geography"].startswith("三大") for x in parsed.records)


def test_other_workbooks_are_rejected_with_a_clear_message():
    wb = openpyxl.Workbook()
    wb.active["A1"] = "something else"
    buf = io.BytesIO()
    wb.save(buf)
    bad = parse_jta_spending_workbook(buf.getvalue(), "x.xlsx")
    assert bad.errors and "Japan Tourism Agency" in bad.errors[0].message


def test_final_release_revises_preliminary_values(real_conn):
    first = run_import(real_conn, "real", "spending_stats", "q2-prelim.xlsx", national_workbook(),
                       parser=parse_jta_spending_workbook)
    final = run_import(real_conn, "real", "spending_stats", "q2-final.xlsx",
                       national_workbook(period="2026年4-6月期 【確報】", tour_spend=2300.0),
                       parser=parse_jta_spending_workbook)
    assert first["status"] == final["status"] == "success"
    assert final["rows_inserted"] == 0 and final["rows_updated"] > 0
    row = real_conn.execute("SELECT evidence_id, value, value_status FROM spending_stats WHERE item = "
                            "'local_tours_guides' AND metric = 'spend_per_person' AND segment = 'All nationalities'"
                            ).fetchone()
    assert (row["value"], row["value_status"]) == (2300.0, "final")
    old = real_conn.execute("SELECT old_value FROM revisions WHERE evidence_id = ? AND field = 'value'",
                            (row["evidence_id"],)).fetchone()
    assert float(old[0]) == pytest.approx(2226.7)


# ------------------------------------------------------------ analysis

def _load_two_years(conn):
    for name, content in [
        ("n25.xlsx", national_workbook(period="2025年4-6月期 【確報】", tour_spend=1684.5, tour_rate=6.8, tour_buyers=488)),
        ("n26.xlsx", national_workbook()),
        ("p25.xlsx", prefecture_workbook(period="2025年（令和7年）4-6月期", tokyo_total=8806.6, tokyo_entertainment=264.8)),
        ("p26.xlsx", prefecture_workbook()),
    ]:
        assert run_import(conn, "real", "spending_stats", name, content,
                          parser=parse_jta_spending_workbook)["status"] == "success"


def test_items_compare_with_the_same_quarter_last_year(real_conn):
    _load_two_years(real_conn)
    data = spending.items(real_conn)
    assert (data["period"], data["comparison_period"]) == ("2026-Q2", "2025-Q2")
    tour = next(r for r in data["rows"] if r["item"] == "local_tours_guides")
    assert tour["spend_change"]["value"] == pytest.approx((2226.7 - 1684.5) / 1684.5 * 100, abs=0.01)
    assert tour["purchase_rate"] == pytest.approx(8.7562) and tour["buyers"] == 676 and not tour["small_sample"]
    assert tour["estimated_market"] is None  # no JNTO arrivals imported, so no market estimate


def test_market_shows_category_totals_and_change(real_conn):
    _load_two_years(real_conn)
    m = spending.market(real_conn, "Tokyo")
    assert m["period"] == "2026-Q2"
    ent = next(c for c in m["categories"] if c["category"] == "entertainment")
    assert ent["change"]["value"] == pytest.approx((342.13 - 264.8) / 264.8 * 100, abs=0.01)
    assert m["categories"][0]["category"] == "lodging"  # sorted by size


def test_other_segment_is_never_compared_across_years(real_conn):
    _load_two_years(real_conn)
    assert spending.items(real_conn, segment="Other")["comparable"] is False


def test_small_samples_are_flagged(real_conn):
    run_import(real_conn, "real", "spending_stats", "n.xlsx", national_workbook(tour_buyers=20, korea_tour_rate=9.5),
               parser=parse_jta_spending_workbook)
    rows = {r["segment"]: r for r in spending.segments_for_item(real_conn, "entertainment", "local_tours_guides")["rows"]}
    assert rows["All nationalities"]["buyers"] == 20 and rows["All nationalities"]["small_sample"] is True
    assert rows["South Korea"]["buyers"] == 77 and rows["South Korea"]["small_sample"] is False
    tour = next(r for r in spending.items(real_conn)["rows"] if r["item"] == "local_tours_guides")
    assert tour["small_sample"] is True


def test_spending_api(real_conn):
    _load_two_years(real_conn)
    client = TestClient(app)
    assert client.get("/api/spending/market?scope=real").json()["period"] == "2026-Q2"
    assert client.get("/api/spending/items?scope=real&period=2025-Q2").json()["period"] == "2025-Q2"
    assert client.get("/api/spending/items?scope=real&period=bad").status_code == 422
    assert "South Korea" in client.get("/api/spending/segment-names?scope=real").json()


# ------------------------------------------------------------ update checker

def test_release_links_are_read_from_the_source_pages():
    [jnto] = updates.jnto_releases(JNTO_PAGE_HTML)
    assert jnto.url.endswith("/statistics/data/_files/20260916_1615-5.xlsx") and jnto.label == "20260916_1615-5.xlsx"
    jta = updates.jta_releases(JTA_PAGE_HTML)
    # Only past-results quarters from 2024-Q2 on: no PDFs, no calendar-year files, no old-design 2024-Q1.
    assert [(r.period, r.url.rsplit("/", 1)[-1]) for r in jta] == [("2026-Q2", "N2026Q2.xlsx"), ("2026-Q2", "P2026Q2.xlsx")]
    assert all(r.publication_date == "2026-09-30" for r in jta)
    assert "2次速報" in jta[0].label


def fake_client(files: dict[str, bytes], fail: set[str] = frozenset()):
    def handler(request: httpx.Request):
        url = str(request.url)
        if url in fail:
            return httpx.Response(503)
        if url == updates.JNTO_PAGE:
            return httpx.Response(200, text=JNTO_PAGE_HTML)
        if url == updates.JTA_PAGE:
            return httpx.Response(200, text=JTA_PAGE_HTML)
        name = url.rsplit("/", 1)[-1]
        return httpx.Response(200, content=files[name]) if name in files else httpx.Response(404)
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_check_imports_new_files_once(real_conn, monkeypatch):
    monkeypatch.setattr(updates, "PAUSE_SECONDS", 0)
    files = {"N2026Q2.xlsx": national_workbook(), "P2026Q2.xlsx": prefecture_workbook()}
    with fake_client(files) as client:
        first = updates.check_source(real_conn, client, "JTA")
        second = updates.check_source(real_conn, client, "JTA")
    assert [f["result"] for f in first["files"]] == ["imported", "imported"] and first["status"] == "ok"
    assert [f["result"] for f in second["files"]] == ["already imported", "already imported"]
    pub = real_conn.execute("SELECT DISTINCT publication_date FROM spending_stats").fetchall()
    assert [p[0] for p in pub] == ["2026-09-30"]
    assert updates.status(real_conn)["latest"]["spending_period"] == "2026-Q2"


def test_failed_downloads_are_recorded_not_raised(real_conn, monkeypatch):
    monkeypatch.setattr(updates, "PAUSE_SECONDS", 0)
    with fake_client({}, fail={updates.JTA_PAGE}) as client:
        result = updates.check_source(real_conn, client, "JTA")
    assert result["status"] == "failed" and "Could not download" in result["message"]
    assert updates.status(real_conn)["last_checks"]["JTA"]["status"] == "failed"


def test_scheduler_is_off_in_tests_and_due_logic(real_conn):
    assert updates.start_scheduler(0) is None
    assert updates.due(real_conn, 24) is True
    real_conn.execute("INSERT INTO update_checks (checked_at, source, status) VALUES (datetime('now'), 'JTA', 'ok')")
    real_conn.execute("UPDATE update_checks SET checked_at = strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')")
    assert updates.due(real_conn, 24) is False
