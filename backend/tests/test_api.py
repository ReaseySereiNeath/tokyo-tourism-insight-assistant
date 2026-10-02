"""End-to-end API tests through FastAPI's TestClient (no network, no API key)."""
import pytest
from fastapi.testclient import TestClient

from app.importers.feeds import parse_feed
from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


FEEDBACK_CSV = ("text,language,source,rating,permission_basis,publication_date,collection_date\n"
                "The vegetarian options were limited,en,Post-tour survey,3,Own survey with consent,2025-05-01,2025-06-01\n"
                "Guide was great and the pace was fine,en,Post-tour survey,5,Own survey with consent,,2025-06-01\n")


def upload(client, dataset, name, content, scope="real", importer="auto"):
    return client.post(f"/api/imports?scope={scope}", data={"dataset": dataset, "importer": importer},
                       files={"file": (name, content, "text/csv")})


def test_health_without_key(client):
    assert client.get("/api/health").json()["ai_configured"] is False


def test_template_download(client):
    r = client.get("/api/imports/templates/feedback")
    assert r.status_code == 200 and r.text.startswith("text,language,source")


def test_upload_twice_then_trace_evidence(client):
    first = upload(client, "feedback", "fb.csv", FEEDBACK_CSV).json()
    second = upload(client, "feedback", "fb.csv", FEEDBACK_CSV).json()
    assert (first["rows_inserted"], second["rows_inserted"], second["rows_duplicate"]) == (2, 0, 2)
    items = client.get("/api/feedback?scope=real").json()
    assert len(items) == 2
    themes = client.get("/api/feedback/themes?scope=real").json()
    assert themes["method"] == "keyword" and themes["classified"] == 2
    detail = client.get(f"/api/evidence/{items[0]['evidence_id']}?scope=real").json()
    assert detail["import_batch"]["original_filename"] == "fb.csv"
    assert detail["record"]["collection_date"] == "2025-06-01"


def test_rejected_upload_returns_row_errors(client):
    bad = "text,language,source,permission_basis,collection_date\nHi there,en,Survey,Consent,31/12/2025\n"
    r = upload(client, "feedback", "bad.csv", bad).json()
    assert r["status"] == "rejected" and r["errors"][0]["row"] == 2


def test_demo_and_real_data_are_separate(client):
    assert client.post("/api/demo/reset").status_code == 200
    real = {c["dataset"]: c["records"] for c in client.get("/api/overview?scope=real").json()["coverage"]}
    demo = {c["dataset"]: c["records"] for c in client.get("/api/overview?scope=demo").json()["coverage"]}
    assert all(v == 0 for v in real.values())
    assert demo["feedback"] == 40 and demo["visitor_stats"] > 0
    demo_id = client.get("/api/feedback?scope=demo").json()[0]["evidence_id"]
    assert demo_id.startswith("DEMO-")
    assert client.get(f"/api/evidence/{demo_id}?scope=real").status_code == 404


def test_real_report_without_key_is_refused_but_preview_works(client):
    upload(client, "feedback", "fb.csv", FEEDBACK_CSV)
    r = client.post("/api/reports?scope=real")
    assert r.status_code == 400 and "ANTHROPIC_API_KEY" in r.json()["detail"]
    assert client.post("/api/reports?scope=real&provider=demo").status_code == 400
    preview = client.get("/api/reports/preview?scope=real").json()
    assert preview["facts"] and preview["documents"]


def test_demo_report_journey_with_evidence_links(client):
    client.post("/api/demo/reset")
    report = client.post("/api/reports?scope=demo").json()
    assert report["is_example"] is True and report["status"] == "success"
    record_ids = [i for ins in report["result"]["insights"] for i in ins["evidence_ids"] if "-" in i]
    assert record_ids
    for eid in record_ids:
        assert client.get(f"/api/evidence/{eid}?scope=demo").status_code == 200


def test_visitor_series_endpoint(client):
    client.post("/api/demo/reset")
    cat = client.get("/api/visitor-stats/catalog?scope=demo").json()
    japan = next(c for c in cat if c["geography"] == "Japan (synthetic)")
    params = {k: japan[k] for k in ("geography", "metric", "unit", "source")}
    s = client.get("/api/visitor-stats/series", params={**params, "scope": "demo", "origins": ["Germany"],
                                                         "start": "2025-01", "end": "2025-04"}).json()
    values = [p["value"] for p in s["series"][0]["points"]]
    assert values[2] is None  # the deliberate March 2025 gap stays missing


def test_profile_roundtrip(client):
    body = {"business_name": "My Tours", "offerings": "Food walk", "operating_area": "Shinjuku", "capacity": "10",
            "price_range": "10000", "monthly_budget": "50000", "goals": "More weekday bookings", "notes": ""}
    assert client.put("/api/profile?scope=real", json=body).status_code == 200
    assert client.get("/api/profile?scope=real").json()["business_name"] == "My Tours"


def test_feed_requires_permission_confirmation(client):
    r = client.post("/api/imports/news-feed?scope=real", json={"url": "https://example.com/rss"})
    assert r.status_code == 400 and "confirm" in r.json()["detail"]


RSS = b"""<?xml version="1.0"?><rss version="2.0"><channel><title>Example Tourism News</title>
<item><title>Tokyo opens new <b>visitor</b> centre</title><link>https://example.com/a</link>
<description>&lt;p&gt;Short summary&lt;/p&gt;</description><pubDate>Tue, 10 Jun 2025 08:00:00 GMT</pubDate></item>
<item><title></title><link>https://example.com/b</link></item></channel></rss>"""


def test_parse_feed_extracts_title_excerpt_and_date():
    parsed = parse_feed(RSS)
    assert len(parsed.records) == 1
    rec = parsed.records[0]
    assert rec["title"] == "Tokyo opens new visitor centre"
    assert rec["excerpt"] == "Short summary" and rec["publication_date"] == "2025-06-10"
    assert rec["publisher"] == "Example Tourism News" and rec["source_type"] == "feed"
    assert any("no title" in w for w in parsed.warnings)
