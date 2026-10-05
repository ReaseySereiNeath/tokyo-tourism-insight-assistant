"""Local classifier: labelling sheet, method selection and API wiring.

Training itself is not run here (it downloads a 1 GB model); the scoring
helpers are tested when torch is installed.
"""
import csv

import pytest
from fastapi.testclient import TestClient

from app.analysis import stats
from app.db import utcnow
from app.local_model.labels import LabelError, export_sheet, load_reviewed
from app.main import app


def add_feedback(conn, evidence_id, text):
    conn.execute("INSERT INTO import_batches (id, dataset, importer, status, started_at) "
                 "VALUES (1, 'feedback', 'csv', 'success', ?) ON CONFLICT DO NOTHING", (utcnow(),))
    conn.execute("INSERT INTO feedback (evidence_id, text, language, source, permission_basis, collection_date, "
                 "batch_id, created_at) VALUES (?, ?, 'en', 'test', 'own survey', '2026-01-01', 1, ?)",
                 (evidence_id, text, utcnow()))
    conn.commit()


def read_sheet(path):
    with path.open(newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def write_sheet(path, rows):
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)


def test_export_suggests_llm_labels_then_keywords(real_conn, tmp_path):
    add_feedback(real_conn, "fb1", "We walked too fast")
    add_feedback(real_conn, "fb2", "Anything")
    real_conn.execute("INSERT INTO feedback_themes VALUES ('fb2', 'price_and_value', 'llm', 'm', 'negative', ?)",
                      (utcnow(),))
    path = tmp_path / "labels.csv"
    assert export_sheet(real_conn, path)["added"] == 2
    rows = {r["evidence_id"]: r for r in read_sheet(path)}
    assert (rows["fb1"]["themes"], rows["fb1"]["suggested_by"], rows["fb1"]["reviewed"]) == \
        ("pace_and_walking", "keyword", "")
    assert (rows["fb2"]["themes"], rows["fb2"]["sentiment"], rows["fb2"]["suggested_by"]) == \
        ("price_and_value", "negative", "llm")


def test_reexport_keeps_edits_and_appends_new_feedback(real_conn, tmp_path):
    add_feedback(real_conn, "fb1", "We walked too fast")
    path = tmp_path / "labels.csv"
    export_sheet(real_conn, path)
    rows = read_sheet(path)
    rows[0].update(themes="pace_and_walking;accessibility", sentiment="negative", reviewed="yes")
    write_sheet(path, rows)

    add_feedback(real_conn, "fb2", "Great ramen")
    result = export_sheet(real_conn, path)
    assert (result["added"], result["rows"], result["reviewed"]) == (1, 2, 1)
    assert read_sheet(path)[0]["themes"] == "pace_and_walking;accessibility"


def test_only_reviewed_rows_are_loaded(tmp_path):
    path = tmp_path / "labels.csv"
    write_sheet(path, [
        {"evidence_id": "a", "text": "x", "themes": "food_and_drink; crowding", "sentiment": "Mixed", "reviewed": "Yes"},
        {"evidence_id": "b", "text": "y", "themes": "food_and_drink", "sentiment": "", "reviewed": ""},
    ])
    [item] = load_reviewed([path])
    assert (item.evidence_id, item.themes, item.sentiment) == ("a", ["food_and_drink", "crowding"], "mixed")


def test_invalid_reviewed_rows_are_all_reported(tmp_path):
    path = tmp_path / "labels.csv"
    write_sheet(path, [
        {"evidence_id": "a", "text": "x", "themes": "food", "sentiment": "", "reviewed": "yes"},
        {"evidence_id": "b", "text": "y", "themes": "", "sentiment": "angry", "reviewed": "yes"},
    ])
    with pytest.raises(LabelError) as exc:
        load_reviewed([path])
    message = str(exc.value)
    assert "line 2: unknown theme(s) food" in message
    assert "line 3: no themes" in message and "line 3: sentiment must be" in message


def test_theme_summary_prefers_llm_then_local_then_keyword(real_conn):
    add_feedback(real_conn, "fb1", "x")
    assert stats.theme_summary(real_conn)["method"] == "keyword"
    real_conn.execute("INSERT INTO feedback_themes VALUES ('fb1', 'other', 'local', 'm', 'neutral', ?)", (utcnow(),))
    assert stats.theme_summary(real_conn)["method"] == "local"
    real_conn.execute("INSERT INTO feedback_themes VALUES ('fb1', 'other', 'llm', 'm', 'neutral', ?)", (utcnow(),))
    assert stats.theme_summary(real_conn)["method"] == "llm"


def test_api_local_method_without_trained_model():
    client = TestClient(app)
    assert client.get("/api/health").json()["local_model_trained"] is False
    assert client.get("/api/feedback/themes?scope=real&method=local").status_code == 200
    r = client.post("/api/feedback/classify?scope=real&method=local")
    assert r.status_code == 400
    assert "train" in r.json()["detail"] or "requirements-ml" in r.json()["detail"]


def test_decide_themes_and_f1():
    torch = pytest.importorskip("torch")
    from app.local_model.train import decide_themes, f1_scores

    probs = torch.tensor([[0.9, 0.6, 0.1], [0.2, 0.3, 0.1]])
    chosen = decide_themes(probs, 0.5)
    assert chosen.tolist() == [[True, True, False], [False, True, False]]  # row 2 falls back to its top theme
    gold = torch.tensor([[1, 0, 0], [0, 1, 0]])
    scores = f1_scores(chosen, gold)
    assert scores["micro_f1"] == pytest.approx(0.8)
