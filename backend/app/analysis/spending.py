"""Visitor spending analysis (Japan Tourism Agency survey data).

Everything the language model is told about spending is computed here first.

Rules:
- Compare a period only with the same period a year earlier (Q2 with Q2):
  spending is seasonal, so quarter-on-quarter changes mislead.
- 'Other' nationalities changed definition in 2026, so it is never compared
  across years.
- Figures resting on fewer than SMALL_SAMPLE respondents are flagged.
- Only the CURRENT survey design (source 'JTA', 2024-Q2 on) is used for comparisons.
  Earlier designs appear only in history(), as separate series.
- Market size per item is an ESTIMATE: average spend per visitor (JTA) x
  arrivals in the same quarter (JNTO). It is labelled as such everywhere.
"""
import sqlite3

from app.analysis.stats import pct_change
from app.db import rows
from app.importers.jta import CURRENT_SOURCE, SOURCE_2010, SOURCE_2018

# Anything not from an earlier design counts as current (official JTA files, sample data, hand-made CSVs).
CURRENT = f"source NOT IN ('{SOURCE_2010}', '{SOURCE_2018}')"

SMALL_SAMPLE = 50
NOT_COMPARABLE_SEGMENTS = {"Other"}
# JTA segment name -> JNTO origin name, where they differ.
JNTO_ORIGIN = {"All nationalities": "All origins", "Nordic countries": "Nordic countries (total)",
               "Middle East": "Middle East (total)"}

CATEGORY_LABELS = {
    "total": "All spending",
    "group_package_tour": "Group package tours",
    "individual_package": "Individual travel packages",
    "international_fares": "International air and sea fares",
    "package_tours": "Package tours (local share)",
    "package_tour": "Package tours",
    "lodging": "Accommodation",
    "food_drink": "Food and drink",
    "transport": "Transport in Japan",
    "entertainment": "Entertainment and activities",
    "shopping": "Shopping",
    "other": "Other",
}
ITEM_LABELS = {
    "domestic_flights": "Domestic flights", "japan_rail_pass": "Japan Rail Pass", "rail": "Trains and subways",
    "bus": "Buses", "taxi": "Taxis", "car_rental": "Car rental", "domestic_ferries": "Ferries",
    "other_transport": "Other transport",
    "local_tours_guides": "Local tours and guides", "golf_sports_facilities": "Golf and sports facilities",
    "theme_parks": "Theme parks", "stage_music": "Theatre and concerts", "spectator_sports": "Watching sports",
    "museums_zoos_aquariums": "Museums, zoos and aquariums", "ski_lifts": "Ski lifts",
    "onsen_spa_relaxation": "Hot springs, spas and relaxation", "massage_medical": "Massage and medical",
    "exhibitions_conventions": "Exhibitions and conventions", "rentals": "Rentals (not cars)",
    "other_entertainment": "Other activities",
    "sweets_snacks": "Sweets and snacks", "alcohol": "Alcohol", "fresh_produce": "Fresh produce",
    "other_food_tobacco": "Other food, drinks and tobacco", "cosmetics_perfume": "Cosmetics and perfume",
    "medicines": "Medicines", "health_toiletries": "Health goods and toiletries", "clothing": "Clothing",
    "shoes_bags_leather": "Shoes, bags and leather", "electronics": "Electronics", "watches_cameras": "Watches and cameras",
    "jewellery": "Jewellery", "crafts_traditional": "Traditional crafts", "books_magazines": "Books and magazines",
    "music_video_games": "Music, video and games", "other_shopping": "Other shopping", "golf": "Golf courses",
}


def label(category: str, item: str = "") -> str:
    if item:
        return ITEM_LABELS.get(item, item.replace("_", " ").capitalize())
    return CATEGORY_LABELS.get(category, category.replace("_", " ").capitalize())


def same_period_last_year(period: str) -> str:
    if "-Q" in period:
        year, q = period.split("-Q")
        return f"{int(year) - 1}-Q{q}"
    return str(int(period) - 1)


def quarter_months(period: str) -> list[str]:
    year, q = period.split("-Q")
    start = (int(q) - 1) * 3 + 1
    return [f"{year}-{m:02d}" for m in range(start, start + 3)]


def periods(conn: sqlite3.Connection) -> list[dict]:
    """Which periods exist, separately for national tables and prefecture tables."""
    return rows(conn.execute(
        """SELECT reporting_period, period_type,
                  CASE WHEN geography = 'Japan' THEN 'national' ELSE 'prefecture' END AS tables,
                  MIN(value_status) AS value_status, COUNT(*) AS records,
                  MAX(publication_date) AS publication_date
           FROM spending_stats GROUP BY reporting_period, period_type, tables
           ORDER BY reporting_period DESC, tables"""))


def latest_period(conn: sqlite3.Connection, national: bool = True) -> str | None:
    geo = "= 'Japan'" if national else "!= 'Japan'"
    row = conn.execute(f"SELECT MAX(reporting_period) FROM spending_stats WHERE {CURRENT} AND period_type = 'quarter' "
                       f"AND geography {geo}").fetchone()
    return row[0] if row else None


def _value_map(conn, where: str, params: list) -> dict[tuple, dict]:
    out = {}
    for r in rows(conn.execute(
            f"SELECT evidence_id, segment, category, item, metric, value, respondents, value_status "
            f"FROM spending_stats WHERE {CURRENT} AND {where}", params)):
        out[(r["segment"], r["category"], r["item"], r["metric"])] = r
    return out


def quarterly_arrivals(conn: sqlite3.Connection, period: str) -> dict | None:
    """All-origin JNTO arrivals over the three months of a quarter (only if all three months exist)."""
    months = quarter_months(period)
    found = rows(conn.execute(
        f"""SELECT reporting_month, value, value_status, evidence_id FROM visitor_stats
            WHERE geography = 'Japan' AND metric = 'visitor_arrivals' AND visitor_origin = 'All origins'
              AND source = 'JNTO' AND reporting_month IN ({', '.join('?' * 3)})""", months))
    if len(found) != 3:
        return None
    return {"value": sum(r["value"] for r in found), "evidence_ids": [r["evidence_id"] for r in found],
            "non_final": sum(r["value_status"] != "final" for r in found)}


def market(conn: sqlite3.Connection, geography: str = "Tokyo", period: str | None = None) -> dict:
    """Total visitor spending by category in one prefecture, with change vs the same quarter last year."""
    period = period or latest_period(conn, national=False)
    if period is None:
        return {"geography": geography, "period": None, "categories": [], "visitors": None}
    previous = same_period_last_year(period)
    now = _value_map(conn, "geography = ? AND reporting_period = ?", [geography, period])
    before = _value_map(conn, "geography = ? AND reporting_period = ?", [geography, previous])

    def pick(key):
        cur, old = now.get(key), before.get(key)
        return {"value": cur["value"] if cur else None, "evidence_id": cur["evidence_id"] if cur else None,
                "value_last_year": old["value"] if old else None,
                "evidence_id_last_year": old["evidence_id"] if old else None,
                "respondents": cur["respondents"] if cur else None,
                "value_status": cur["value_status"] if cur else None,
                "change": pct_change(cur["value"] if cur else None, old["value"] if old else None)}

    categories = []
    for (seg, cat, item, metric), r in now.items():
        if metric == "total_spend" and cat != "total":
            categories.append({"category": cat, "label": label(cat), **pick((seg, cat, item, metric))})
    categories.sort(key=lambda c: -(c["value"] or 0))
    total = pick(("All nationalities", "total", "", "total_spend"))
    return {
        "geography": geography, "period": period, "comparison_period": previous,
        "total": total, "categories": categories,
        "visitors": pick(("All nationalities", "total", "", "visitors")),
        "spend_per_person": pick(("All nationalities", "total", "", "spend_per_person")),
        "visit_rate": pick(("All nationalities", "total", "", "visit_rate")),
    }


def items(conn: sqlite3.Connection, segment: str = "All nationalities", period: str | None = None) -> dict:
    """Spend per visitor on every category and item (national), with purchase rates and yearly change."""
    period = period or latest_period(conn)
    if period is None:
        return {"period": None, "segment": segment, "rows": []}
    previous = same_period_last_year(period)
    comparable = segment not in NOT_COMPARABLE_SEGMENTS
    now = _value_map(conn, "geography = 'Japan' AND segment = ? AND reporting_period = ?", [segment, period])
    before = _value_map(conn, "geography = 'Japan' AND segment = ? AND reporting_period = ?", [segment, previous]) \
        if comparable else {}
    arrivals = quarterly_arrivals(conn, period) if segment == "All nationalities" else None

    out = []
    for (seg, cat, item, metric), spend in now.items():
        if metric != "spend_per_person" or cat == "total":
            continue
        rate = now.get((seg, cat, item, "purchase_rate"))
        per_buyer = now.get((seg, cat, item, "spend_per_purchaser"))
        old = before.get((seg, cat, item, "spend_per_person"))
        old_rate = before.get((seg, cat, item, "purchase_rate"))
        respondents = rate["respondents"] if rate else None
        out.append({
            "category": cat, "item": item, "label": label(cat, item), "category_label": label(cat),
            "spend_per_person": spend["value"], "evidence_id": spend["evidence_id"],
            "spend_per_person_last_year": old["value"] if old else None,
            "evidence_id_last_year": old["evidence_id"] if old else None,
            "spend_change": pct_change(spend["value"], old["value"] if old else None)
            if comparable else {"value": None, "status": "not_comparable"},
            "purchase_rate": rate["value"] if rate else None,
            "purchase_rate_last_year": old_rate["value"] if old_rate else None,
            "purchase_rate_evidence_id": rate["evidence_id"] if rate else None,
            "spend_per_purchaser": per_buyer["value"] if per_buyer else None,
            "buyers": respondents,
            "small_sample": respondents is not None and respondents < SMALL_SAMPLE,
            "value_status": spend["value_status"],
            # Estimate, labelled as such: average spend per visitor x arrivals that quarter.
            "estimated_market": round(spend["value"] * arrivals["value"]) if arrivals else None,
        })
    out.sort(key=lambda r: -(r["spend_per_person"] or 0))
    total = now.get((segment, "total", "", "spend_per_person"))
    return {"period": period, "comparison_period": previous, "segment": segment, "comparable": comparable,
            "total_spend_per_person": total["value"] if total else None,
            "arrivals": arrivals, "rows": out}


def segments_for_item(conn: sqlite3.Connection, category: str, item: str = "", period: str | None = None) -> dict:
    """For one item: which nationalities buy it most often and spend most, next to their arrival growth."""
    period = period or latest_period(conn)
    if period is None:
        return {"period": None, "rows": []}
    data = rows(conn.execute(
        f"""SELECT segment, metric, value, respondents, evidence_id FROM spending_stats
           WHERE {CURRENT} AND geography = 'Japan' AND reporting_period = ? AND category = ? AND item = ?""",
        (period, category, item)))
    by_segment: dict[str, dict] = {}
    for r in data:
        s = by_segment.setdefault(r["segment"], {"segment": r["segment"], "buyers": None})
        s[r["metric"]] = r["value"]
        s[f"{r['metric']}_evidence_id"] = r["evidence_id"]
        if r["metric"] == "purchase_rate":
            s["buyers"] = r["respondents"]
    growth = arrival_growth_by_origin(conn, period)
    out = []
    for s in by_segment.values():
        s["small_sample"] = s.get("buyers") is not None and s["buyers"] < SMALL_SAMPLE
        s["arrivals"] = None if s["segment"] in NOT_COMPARABLE_SEGMENTS else growth.get(JNTO_ORIGIN.get(s["segment"], s["segment"]))
        out.append(s)
    # All visitors first, then groups with enough buyers to trust, then small samples; each by how often they buy.
    out.sort(key=lambda s: (s["segment"] != "All nationalities", s["small_sample"], -(s.get("purchase_rate") or 0)))
    return {"period": period, "category": category, "item": item, "label": label(category, item), "rows": out}


def arrival_growth_by_origin(conn: sqlite3.Connection, period: str) -> dict[str, dict]:
    """JNTO arrivals per origin over a quarter vs the same quarter last year (only complete quarters)."""
    months, last_year = quarter_months(period), quarter_months(same_period_last_year(period))
    data = rows(conn.execute(
        f"""SELECT visitor_origin, reporting_month, value, evidence_id FROM visitor_stats
            WHERE geography = 'Japan' AND metric = 'visitor_arrivals' AND source = 'JNTO'
              AND reporting_month IN ({', '.join('?' * 6)})""", months + last_year))
    by_origin: dict[str, dict] = {}
    for r in data:
        o = by_origin.setdefault(r["visitor_origin"], {"now": {}, "before": {}, "ids": []})
        (o["now"] if r["reporting_month"] in months else o["before"])[r["reporting_month"]] = r["value"]
        o["ids"].append(r["evidence_id"])
    out = {}
    for origin, o in by_origin.items():
        now = sum(o["now"].values()) if len(o["now"]) == 3 else None
        before = sum(o["before"].values()) if len(o["before"]) == 3 else None
        out[origin] = {"value": now, "value_last_year": before, "change": pct_change(now, before),
                       "evidence_ids": o["ids"]}
    return out


def segment_preferences(conn: sqlite3.Connection, period: str, segment: str, top: int = 3) -> list[dict]:
    """Items a visitor group buys more often than visitors overall (both samples large enough)."""
    data = rows(conn.execute(
        f"""SELECT s.category, s.item, s.value AS rate, s.respondents AS buyers, s.evidence_id,
                  a.value AS rate_all, a.evidence_id AS evidence_id_all
           FROM spending_stats s JOIN spending_stats a
             ON a.source = s.source AND a.geography = 'Japan' AND a.reporting_period = s.reporting_period
            AND a.metric = 'purchase_rate'
            AND a.segment = 'All nationalities' AND a.category = s.category AND a.item = s.item
           WHERE s.{CURRENT} AND s.geography = 'Japan' AND s.reporting_period = ? AND s.metric = 'purchase_rate'
             AND s.segment = ?
             AND s.item != '' AND s.respondents >= ? AND a.value >= 1""",
        (period, segment, SMALL_SAMPLE)))
    for r in data:
        r["ratio"] = r["rate"] / r["rate_all"]
        r["label"] = label(r["category"], r["item"])
    return sorted((r for r in data if r["ratio"] > 1.2), key=lambda r: -r["ratio"])[:top]


def highlights(conn: sqlite3.Connection, top: int = 5) -> dict:
    """Fastest-growing and largest spending items (enough buyers, at least ¥300 per visitor)."""
    data = items(conn)
    usable = [r for r in data["rows"] if r["item"] and not r["small_sample"] and r["buyers"]
              and r["spend_per_person"] >= 300]
    growing = sorted([r for r in usable if r["spend_change"]["status"] == "ok"], key=lambda r: -r["spend_change"]["value"])
    return {"period": data["period"], "comparison_period": data.get("comparison_period"),
            "growing": growing[:top], "largest": sorted(usable, key=lambda r: -r["spend_per_person"])[:top]}


HISTORY_CATEGORIES = ["lodging", "food_drink", "transport", "entertainment", "shopping"]
DESIGNS = [  # oldest first
    {"source": SOURCE_2010, "label": "2010-2017 survey", "from": "2010-Q2", "to": "2017-Q4"},
    {"source": SOURCE_2018, "label": "2018-2024 survey", "from": "2018-Q1", "to": "2024-Q1"},
    {"source": CURRENT_SOURCE, "label": "Current survey", "from": "2024-Q2", "to": None},
]


def history(conn: sqlite3.Connection, segment: str = "All nationalities") -> dict:
    """Spending per visitor on the main categories, every quarter since 2010, one series per survey design.

    Computed the same way in every era: share of visitors who bought (purchase rate) x what buyers
    spent. That leaves out package-tour fees split across categories, so values differ from the
    'per visitor' figures elsewhere, but they are comparable within each design.
    """
    data = rows(conn.execute(
        f"""SELECT source, reporting_period, category, metric, value, evidence_id FROM spending_stats
            WHERE geography = 'Japan' AND segment = ? AND item = '' AND period_type = 'quarter'
              AND metric IN ('purchase_rate', 'spend_per_purchaser')
              AND category IN ({', '.join('?' * len(HISTORY_CATEGORIES))})""",
        [segment, *HISTORY_CATEGORIES]))
    cells: dict[tuple, dict] = {}
    for r in data:
        cells.setdefault((r["source"], r["reporting_period"], r["category"]), {})[r["metric"]] = r
    points: dict[tuple, dict] = {}
    for (source, period, category), m in cells.items():
        rate, buyer = m.get("purchase_rate"), m.get("spend_per_purchaser")
        p = points.setdefault((source, period), {"period": period, "source": source, "values": {}, "evidence_ids": []})
        if rate and buyer:
            p["values"][category] = round(rate["value"] / 100 * buyer["value"], 1)
            p["evidence_ids"] += [rate["evidence_id"], buyer["evidence_id"]]
    designs = []
    for d in DESIGNS:
        old = {SOURCE_2010, SOURCE_2018}
        series = sorted((p for p in points.values()
                         if p["source"] == d["source"] or (d["source"] == CURRENT_SOURCE and p["source"] not in old)),
                        key=lambda p: p["period"])
        if series:
            designs.append({**d, "points": series})
    return {"segment": segment, "categories": [{"key": c, "label": label(c)} for c in HISTORY_CATEGORIES],
            "designs": designs,
            "gaps": [{"from": "2020-Q2", "to": "2022-Q3",
                      "reason": "No usable survey while entry was restricted for COVID-19: April 2020 to September "
                                "2021 were not surveyed, and the rough estimates for October 2021 to September 2022 "
                                "do not include spending by category."}]}
