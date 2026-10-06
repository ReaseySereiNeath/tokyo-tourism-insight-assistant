"""Retrieval: choose the evidence a report is allowed to use.

No vector database: we select evidence with ordinary queries.

The pack contains:
- facts: numbers computed in Python (app/analysis/stats.py), each with an ID
  (F1, F2, ...) and the record IDs it was computed from
- documents: a bounded selection of feedback, news, and competitor offers,
  marked as untrusted text
- data_gaps: what is missing, so the model can say evidence is insufficient

The exact pack is stored with each report, so every claim can be traced.
"""
import json
import sqlite3

from app.analysis import stats
from app.config import Settings
from app.db import rows, utcnow


def _truncate(text: str | None, limit: int) -> str | None:
    if text is None:
        return None
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _fmt(n: float | None) -> str:
    return "missing" if n is None else f"{n:,.0f}"


def _pct(change: dict) -> str:
    return f"{change['value']:+.1f}%" if change["status"] == "ok" else f"not computable ({change['status']})"


def load_profile(conn: sqlite3.Connection) -> dict:
    row = conn.execute("SELECT data_json FROM business_profile WHERE id = 1").fetchone()
    return json.loads(row[0]) if row else {}


class PackBuilder:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.facts: list[dict] = []
        self.documents: list[dict] = []
        self.chars = 0
        self.dropped = 0

    def fact(self, kind: str, statement: str, evidence_ids: list[str], data: dict | None = None) -> None:
        ids = [i for i in evidence_ids if i][:30]
        self.facts.append({"id": f"F{len(self.facts) + 1}", "kind": kind, "statement": statement,
                           "evidence_ids": ids, "data": data or {}})
        self.chars += len(statement) + 20 * len(ids)

    def document(self, doc: dict) -> bool:
        size = len(json.dumps(doc, ensure_ascii=False))
        if self.chars + size > self.settings.ai_max_evidence_chars:
            self.dropped += 1
            return False
        self.documents.append(doc)
        self.chars += size
        return True


def build_evidence_pack(conn: sqlite3.Connection, scope: str, settings: Settings) -> dict:
    b = PackBuilder(settings)
    gaps: list[str] = []
    excerpt = settings.ai_max_excerpt_chars

    # --- visitor statistics -------------------------------------------------
    trends = stats.key_trends(conn, top_n=4)
    if not trends:
        gaps.append("No visitor statistics imported.")
    for t in trends:
        label = f"[{t['geography']} | {t['metric']} | source {t['source']}]"
        non_final = f" Note: {t['non_final_records']} records in this series are provisional or estimates." \
            if t["non_final_records"] else ""
        if t["total"] is not None:
            b.fact("visitor_total",
                   f"{label} All-origin total for {t['latest_month']}: {_fmt(t['total'])} {t['unit']}; "
                   f"change vs {t['comparison_month']}: {_pct(t['total_yoy'])}.{non_final}",
                   [t["total_evidence_id"]], {"geography": t["geography"], "month": t["latest_month"]})
        for kind, items in (("visitor_growth", t["top_growth"]), ("visitor_decline", t["top_decline"])):
            for r in items:
                b.fact(kind,
                       f"{label} {r['visitor_origin']}: {_fmt(r['value'])} in {t['latest_month']} vs "
                       f"{_fmt(r['value_last_year'])} in {t['comparison_month']} ({_pct(r['yoy'])}); "
                       f"share of total {r['share_of_total_pct'] if r['share_of_total_pct'] is not None else 'n/a'}%. "
                       f"Status: {r['value_status']}.",
                       [r["evidence_id"], r["evidence_id_last_year"]])
        if t["comparable_origins"] < t["country_rows"]:
            gaps.append(f"{label} Only {t['comparable_origins']} of {t['country_rows']} origins have a "
                        f"comparable month a year earlier.")
    geos = {t["geography"] for t in trends}
    if trends and not any("tokyo" in g.lower() for g in geos):
        gaps.append("No Tokyo-specific visitor statistics: Japan-wide arrivals do not show how many visit Tokyo "
                    "or join tours.")

    # --- competitors --------------------------------------------------------
    comp = stats.competitor_summary(conn)
    if comp["offers"] == 0:
        gaps.append("No competitor offers imported.")
    else:
        for c in comp["by_currency"]:
            b.fact("competitor_price",
                   f"Competitor prices ({c['currency']}, latest observation per offer, n={c['n']}): "
                   f"min {_fmt(c['min'])}, median {_fmt(c['median'])}, max {_fmt(c['max'])}. "
                   f"{comp['missing_price']} offers without a published price are excluded.",
                   c["evidence_ids"])
        langs = ", ".join(f"{l['language']} {l['offers']}" for l in comp["by_language"])
        b.fact("competitor_languages", f"Competitor offers by tour language (n={comp['offers']}): {langs}.",
               [], {"observed_from": comp["observed_from"], "observed_to": comp["observed_to"]})
        if comp["duration_median_minutes"] is not None:
            b.fact("competitor_duration",
                   f"Median competitor tour duration: {comp['duration_median_minutes']:.0f} minutes "
                   f"(n={comp['duration_n']}, {comp['missing_duration']} unknown).", [])

    # --- feedback themes ----------------------------------------------------
    themes = stats.theme_summary(conn, examples_per_theme=3)
    if themes["total_feedback"] == 0:
        gaps.append("No customer feedback imported.")
    elif themes["classified"] == 0:
        gaps.append("Feedback has not been classified into themes yet.")
    else:
        method_note = {"llm": "labels from a language model",
                       "local": "labels from a small classifier trained on the owner's own labelled feedback",
                       }.get(themes["method"], "labels from simple keyword rules (crude; may miss or mislabel)")
        if themes["total_feedback"] < 30:
            gaps.append(f"Only {themes['total_feedback']} feedback items: theme counts are small samples.")
        for t in themes["themes"]:
            ids = [r[0] for r in conn.execute(
                "SELECT evidence_id FROM feedback_themes WHERE method = ? AND theme = ? LIMIT 30",
                (themes["method"], t["theme"]))]
            sentiment = (f" Sentiment: {t['negative'] or 0} negative, {t['positive'] or 0} positive, "
                         f"{t['mixed'] or 0} mixed." if themes["method"] in ("llm", "local") else "")
            b.fact("feedback_theme",
                   f"Feedback theme '{t['theme']}': {t['count']} of {themes['classified']} classified items "
                   f"({t['share_pct']}%), {method_note}.{sentiment}", ids)

    # --- documents (untrusted text) ------------------------------------------
    seen: set[str] = set()
    for t in themes["themes"] if themes["classified"] else []:
        for ex in t["examples"]:
            if ex["evidence_id"] in seen:
                continue
            seen.add(ex["evidence_id"])
            b.document({"evidence_id": ex["evidence_id"], "type": "feedback", "language": ex["language"],
                        "source": ex["source"], "rating": ex["rating"], "publication_date": ex["publication_date"],
                        "collection_date": ex["collection_date"], "text": _truncate(ex["text"], excerpt)})
    for n in rows(conn.execute(
            "SELECT * FROM news ORDER BY COALESCE(publication_date, collection_date) DESC LIMIT 10")):
        b.document({"evidence_id": n["evidence_id"], "type": "news", "title": n["title"],
                    "publisher": n["publisher"], "publication_date": n["publication_date"],
                    "collection_date": n["collection_date"], "excerpt": _truncate(n["excerpt"], excerpt)})
    if not conn.execute("SELECT 1 FROM news LIMIT 1").fetchone():
        gaps.append("No news imported.")
    for o in rows(conn.execute(
            """SELECT * FROM competitor_offers c WHERE date_observed = (
                   SELECT MAX(date_observed) FROM competitor_offers c2
                   WHERE c2.business = c.business AND c2.tour_name = c.tour_name AND c2.language = c.language)
               ORDER BY business LIMIT 40""")):
        b.document({"evidence_id": o["evidence_id"], "type": "competitor_offer", "business": o["business"],
                    "tour_name": o["tour_name"], "area": o["area"], "price": o["price"], "currency": o["currency"],
                    "duration_minutes": o["duration_minutes"], "language": o["language"],
                    "date_observed": o["date_observed"], "notes": _truncate(o["notes"], 200)})
    if b.dropped:
        gaps.append(f"{b.dropped} documents were left out to keep the request within the size limit.")

    return {
        "generated_at": utcnow(),
        "scope": scope,
        "business_profile": load_profile(conn),
        "facts": b.facts,
        "documents": b.documents,
        "data_gaps": gaps,
        "size": {"chars": b.chars, "documents_dropped": b.dropped, "limit_chars": settings.ai_max_evidence_chars},
    }


def citable_ids(pack: dict) -> set[str]:
    """IDs the model may cite: fact IDs plus every record ID the pack contains."""
    ids = {f["id"] for f in pack["facts"]}
    for f in pack["facts"]:
        ids.update(f["evidence_ids"])
    ids.update(d["evidence_id"] for d in pack["documents"])
    return ids
