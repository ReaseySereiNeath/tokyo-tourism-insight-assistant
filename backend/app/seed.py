"""Load the synthetic demonstration data into data/demo.db.

Run:  python -m app.seed            (safe to run repeatedly: duplicates are skipped)
      python -m app.seed --reset    (delete demo.db first)

Demo data goes through exactly the same import pipeline as real files.
It is written ONLY to the demo database.
"""
import json
import sys

from app.analysis.themes import classify_with_keywords
from app.config import BACKEND_DIR
from app.db import connect, db_path, utcnow
from app.importers.service import run_import

DEMO_FILES = {
    "visitor_stats": "demo_visitor_stats.csv",
    "competitor_offers": "demo_competitor_offers.csv",
    "feedback": "demo_feedback.csv",
    "news": "demo_news.csv",
}

DEMO_PROFILE = {
    "business_name": "Sample Walking & Food Tours (demo profile)",
    "offerings": "English-language evening food walk in Shinjuku (3h, 6 stops); morning old-town walk in Yanaka (2.5h)",
    "operating_area": "Shinjuku, Yanaka, Asakusa",
    "capacity": "2 guides, up to 10 guests per tour, about 12 tours per week",
    "price_range": "JPY 8,000-14,000 per adult",
    "monthly_budget": "JPY 150,000 for marketing and experiments",
    "goals": "Raise weekday occupancy; test one new tour format this quarter; improve review ratings above 4.7",
    "notes": "Synthetic profile used with demonstration data.",
}


def seed(reset: bool = False) -> None:
    if reset:
        base = db_path("demo")
        for path in (base, base.with_name(base.name + "-wal"), base.with_name(base.name + "-shm")):
            path.unlink(missing_ok=True)
    conn = connect("demo")
    for dataset, filename in DEMO_FILES.items():
        path = BACKEND_DIR / "demo_data" / filename
        batch = run_import(conn, "demo", dataset, filename, path.read_bytes())
        print(f"{dataset:18} {batch['status']:8} inserted={batch['rows_inserted']} "
              f"duplicate={batch['rows_duplicate']} errors={batch['error_count']}")
        if batch["errors"]:
            print(json.dumps(batch["errors"][:5], indent=2))
    print("keyword themes:", classify_with_keywords(conn))
    conn.execute("INSERT OR IGNORE INTO business_profile (id, data_json, updated_at) VALUES (1, ?, ?)",
                 (json.dumps(DEMO_PROFILE), utcnow()))
    conn.commit()
    conn.close()


if __name__ == "__main__":
    seed(reset="--reset" in sys.argv)
