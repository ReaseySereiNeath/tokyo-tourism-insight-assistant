"""Demand signals for choosing a business, computed from the spending survey.

Everything here is arithmetic on published figures, done in code so the
language model only interprets it:

- item scorecards: size (estimated market), growth (vs the same quarter a year
  earlier), momentum (in how many recent quarters the item grew), reliability
  (survey buyers behind the figure)
- Tokyo's share of each spending category (sum of the 47 prefecture figures as
  the national base) and how that share moved
- seasonality: which quarter each category peaks in Tokyo
- long-term trends, compared only WITHIN one survey design

The demand score is deliberately simple and shown with its parts, so nobody
has to trust a black box: rank of size + rank of growth + momentum, scaled to 1-5.
"""
import sqlite3

from app.analysis import spending
from app.analysis.stats import pct_change
from app.db import rows
from app.importers.jta import SOURCE_2010, SOURCE_2018

MIN_SPEND = 300  # yen per visitor: below this an item is too small to build a business on alone
QUARTER_NAMES = {1: "Jan-Mar", 2: "Apr-Jun", 3: "Jul-Sep", 4: "Oct-Dec"}


def _periods(conn: sqlite3.Connection, latest: str, count: int) -> list[str]:
    """The `count` most recent current-design quarters up to `latest`, oldest first."""
    found = [r[0] for r in conn.execute(
        f"SELECT DISTINCT reporting_period FROM spending_stats WHERE {spending.CURRENT} AND geography = 'Japan' "
        "AND period_type = 'quarter' AND reporting_period <= ? ORDER BY reporting_period DESC LIMIT ?", (latest, count))]
    return sorted(found)


def item_scorecards(conn: sqlite3.Connection, period: str | None = None) -> dict:
    """One scorecard per spending item (all visitors, Japan-wide), with a transparent 1-5 demand score."""
    latest = spending.items(conn, period=period)
    if latest["period"] is None:
        return {"period": None, "items": []}
    # Momentum: year-on-year change in each recent quarter that has a comparison.
    history: dict[str, list[dict]] = {}
    for p in _periods(conn, latest["period"], 5):
        for r in spending.items(conn, period=p)["rows"]:
            if r["item"] and r["spend_change"]["status"] == "ok":
                history.setdefault(f"{r['category']}/{r['item']}", []).append(
                    {"period": p, "change": r["spend_change"]["value"]})
    cards = []
    for r in latest["rows"]:
        if not r["item"] or r["small_sample"] or not r["buyers"] or r["spend_per_person"] < MIN_SPEND:
            continue
        key = f"{r['category']}/{r['item']}"
        yoy = history.get(key, [])
        cards.append({
            "key": key, "label": r["label"], "category": r["category"], "category_label": r["category_label"],
            "period": latest["period"], "comparison_period": latest["comparison_period"],
            "spend_per_person": r["spend_per_person"], "purchase_rate": r["purchase_rate"],
            "spend_per_purchaser": r["spend_per_purchaser"], "buyers": r["buyers"],
            "estimated_market": r["estimated_market"], "change": r["spend_change"],
            "quarters_growing": sum(1 for q in yoy if q["change"] > 0), "quarters_compared": len(yoy),
            "yoy_by_quarter": yoy, "value_status": r["value_status"],
            "evidence_ids": [i for i in (r["evidence_id"], r["evidence_id_last_year"], r["purchase_rate_evidence_id"]) if i],
        })
    _score(cards)
    cards.sort(key=lambda c: (-c["score"], -c["spend_per_person"]))
    return {"period": latest["period"], "comparison_period": latest["comparison_period"], "items": cards}


def _score(cards: list[dict]) -> None:
    """score = average of three 0-1 parts (size rank, growth rank, momentum share), mapped to 1-5."""
    n = len(cards)
    if n == 0:
        return
    size = sorted(cards, key=lambda c: c["estimated_market"] or c["spend_per_person"])
    growth = sorted(cards, key=lambda c: c["change"]["value"] if c["change"]["status"] == "ok" else float("-inf"))
    size_rank = {id(c): i / max(n - 1, 1) for i, c in enumerate(size)}
    growth_rank = {id(c): i / max(n - 1, 1) for i, c in enumerate(growth)}
    for c in cards:
        momentum = c["quarters_growing"] / c["quarters_compared"] if c["quarters_compared"] else 0.0
        parts = {"size": round(size_rank[id(c)], 2), "growth": round(growth_rank[id(c)], 2), "momentum": round(momentum, 2)}
        c["score_parts"] = parts
        c["score"] = round(1 + 4 * sum(parts.values()) / 3, 1)


def tokyo_share(conn: sqlite3.Connection, period: str | None = None) -> dict:
    """Tokyo's share of visitor spending per category, against the sum of all 47 prefectures."""
    period = period or spending.latest_period(conn, national=False)
    if period is None:
        return {"period": None, "categories": []}
    previous = spending.same_period_last_year(period)

    def shares(p: str) -> dict[str, dict]:
        out = {}
        for r in rows(conn.execute(
                f"""SELECT category, SUM(value) AS total, SUM(CASE WHEN geography = 'Tokyo' THEN value END) AS tokyo,
                           COUNT(*) AS prefectures, MAX(CASE WHEN geography = 'Tokyo' THEN evidence_id END) AS evidence_id
                    FROM spending_stats WHERE {spending.CURRENT} AND geography != 'Japan' AND metric = 'total_spend'
                      AND reporting_period = ? GROUP BY category""", (p,))):
            if r["total"] and r["tokyo"] is not None:
                out[r["category"]] = {**r, "share": round(r["tokyo"] / r["total"] * 100, 1)}
        return out

    now, before = shares(period), shares(previous)
    cats = []
    for cat, r in now.items():
        old = before.get(cat)
        cats.append({"category": cat, "label": spending.label(cat), "tokyo": r["tokyo"], "share": r["share"],
                     "share_last_year": old["share"] if old else None,
                     "share_change_points": round(r["share"] - old["share"], 1) if old else None,
                     "prefectures": r["prefectures"],
                     "evidence_ids": [i for i in (r["evidence_id"], old and old["evidence_id"]) if i]})
    cats.sort(key=lambda c: -c["tokyo"])
    return {"period": period, "comparison_period": previous, "categories": cats}


def seasonality(conn: sqlite3.Connection, geography: str = "Tokyo") -> dict:
    """Average spending per category by quarter of the year (only quarters seen at least once)."""
    data = rows(conn.execute(
        f"""SELECT reporting_period, category, value FROM spending_stats
            WHERE {spending.CURRENT} AND geography = ? AND metric = 'total_spend' AND period_type = 'quarter'
              AND category != 'other'""", (geography,)))
    by: dict[str, dict[int, list[float]]] = {}
    for r in data:
        by.setdefault(r["category"], {}).setdefault(int(r["reporting_period"][-1]), []).append(r["value"])
    out = []
    for cat, quarters in by.items():
        avg = {q: sum(v) / len(v) for q, v in quarters.items()}
        if len(avg) < 4:
            continue  # need every quarter of the year to say anything about seasons
        peak, low = max(avg, key=avg.get), min(avg, key=avg.get)
        out.append({"category": cat, "label": spending.label(cat), "peak": QUARTER_NAMES[peak], "low": QUARTER_NAMES[low],
                    "peak_vs_low_pct": round((avg[peak] / avg[low] - 1) * 100, 1) if avg[low] else None,
                    "years": min(len(v) for v in quarters.values())})
    out.sort(key=lambda c: -(c["peak_vs_low_pct"] or 0))
    return {"geography": geography, "categories": out}


def long_term(conn: sqlite3.Connection) -> list[dict]:
    """Per category: change over each survey design's span, same quarter of the year at both ends.

    Never compares across designs. Uses the history measure (share who buy x spend per buyer)."""
    h = spending.history(conn)
    out = []
    for d in h["designs"]:
        pts = [p for p in d["points"] if len(p["values"]) == len(spending.HISTORY_CATEGORIES)]
        if len(pts) < 5:
            continue
        last = pts[-1]
        # The earliest point in the same quarter of the year as the last one.
        first = next((p for p in pts if p["period"][-2:] == last["period"][-2:] and p["period"] < last["period"]), None)
        if first is None:
            continue
        for cat in spending.HISTORY_CATEGORIES:
            out.append({"design": d["label"], "source": d["source"], "category": cat, "label": spending.label(cat),
                        "from": first["period"], "to": last["period"],
                        "value_from": first["values"][cat], "value_to": last["values"][cat],
                        "change": pct_change(last["values"][cat], first["values"][cat]),
                        "evidence_ids": first["evidence"][cat] + last["evidence"][cat],
                        "earlier_design": d["source"] in (SOURCE_2010, SOURCE_2018)})
    return out
