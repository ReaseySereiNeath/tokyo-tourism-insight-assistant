"""Numerical analysis with pandas. Everything the language model is told about
numbers is computed here first.

Rules enforced in this module:
- A series is one (geography, metric, unit, source, origin) combination.
  Different geographies or sources are never merged into one line.
- Missing months stay missing (None), so charts show gaps instead of zeros.
- Month-over-month needs the immediately previous month; year-over-year needs
  the same month one year earlier. Otherwise the change is None with a reason.
- Division by zero yields None with status 'zero_base', never infinity.
"""
import sqlite3

import pandas as pd

from app.db import rows


def pct_change(current: float | None, previous: float | None) -> dict:
    """Percentage change with an explicit status explaining any missing result."""
    if current is None or pd.isna(current):
        return {"value": None, "status": "missing_current"}
    if previous is None or pd.isna(previous):
        return {"value": None, "status": "missing_previous"}
    if previous == 0:
        return {"value": None, "status": "zero_base"}
    return {"value": round((current - previous) / previous * 100, 2), "status": "ok"}


def share(part: float | int | None, whole: float | int | None) -> float | None:
    """Percentage share; None if either side is missing or the denominator is zero."""
    if part is None or whole is None or pd.isna(part) or pd.isna(whole) or whole == 0:
        return None
    return round(part / whole * 100, 1)


def previous_month(month: str) -> str:
    return (pd.Period(month, freq="M") - 1).strftime("%Y-%m")


def same_month_last_year(month: str) -> str:
    return (pd.Period(month, freq="M") - 12).strftime("%Y-%m")


# ---------------------------------------------------------------- visitor stats

def series_catalog(conn: sqlite3.Connection) -> list[dict]:
    """Which (geography, metric, unit, source) combinations exist, with coverage."""
    return rows(conn.execute(
        """SELECT geography, metric, unit, source,
                  COUNT(*) AS records, COUNT(DISTINCT visitor_origin) AS origins,
                  MIN(reporting_month) AS first_month, MAX(reporting_month) AS last_month,
                  SUM(value_status != 'final') AS non_final_records
           FROM visitor_stats GROUP BY geography, metric, unit, source
           ORDER BY geography, metric, source"""))


def origins_for(conn: sqlite3.Connection, geography: str, metric: str, unit: str, source: str) -> list[dict]:
    return rows(conn.execute(
        """SELECT visitor_origin, origin_level, COUNT(*) AS months, MAX(reporting_month) AS last_month
           FROM visitor_stats WHERE geography = ? AND metric = ? AND unit = ? AND source = ?
           GROUP BY visitor_origin, origin_level
           ORDER BY CASE origin_level WHEN 'total' THEN 0 WHEN 'region' THEN 1 WHEN 'country' THEN 2 ELSE 3 END,
                    visitor_origin""",
        (geography, metric, unit, source)))


def load_series_frame(conn: sqlite3.Connection, geography: str, metric: str, unit: str, source: str,
                      origins: list[str] | None = None, start: str | None = None, end: str | None = None
                      ) -> pd.DataFrame:
    sql = ["SELECT evidence_id, reporting_month, visitor_origin, origin_level, value, value_status "
           "FROM visitor_stats WHERE geography = ? AND metric = ? AND unit = ? AND source = ?"]
    params: list = [geography, metric, unit, source]
    if origins:
        sql.append(f"AND visitor_origin IN ({', '.join('?' * len(origins))})")
        params += origins
    # Load one extra year before `start` so YoY can be computed for the first visible month.
    if start:
        sql.append("AND reporting_month >= ?")
        params.append(same_month_last_year(start))
    if end:
        sql.append("AND reporting_month <= ?")
        params.append(end)
    return pd.read_sql_query(" ".join(sql), conn, params=params)


def monthly_series(conn: sqlite3.Connection, geography: str, metric: str, unit: str, source: str,
                   origins: list[str], start: str | None = None, end: str | None = None) -> dict:
    """Monthly values per origin on a complete month grid, with MoM and YoY changes."""
    df = load_series_frame(conn, geography, metric, unit, source, origins, start, end)
    if df.empty:
        return {"months": [], "series": [], "geography": geography, "metric": metric, "unit": unit, "source": source}

    first = start or df["reporting_month"].min()
    last = end or df["reporting_month"].max()
    grid = pd.period_range(first, last, freq="M").strftime("%Y-%m").tolist()

    series = []
    for origin, group in df.groupby("visitor_origin", sort=False):
        by_month = group.set_index("reporting_month")
        points = []
        for month in grid:
            row = by_month.loc[month] if month in by_month.index else None
            value = None if row is None else float(row["value"])
            prev = by_month.loc[previous_month(month)]["value"] if previous_month(month) in by_month.index else None
            ly = by_month.loc[same_month_last_year(month)]["value"] if same_month_last_year(month) in by_month.index else None
            points.append({
                "month": month,
                "value": value,
                "evidence_id": None if row is None else row["evidence_id"],
                "value_status": None if row is None else row["value_status"],
                "mom": pct_change(value, None if prev is None else float(prev)),
                "yoy": pct_change(value, None if ly is None else float(ly)),
            })
        present = [p for p in points if p["value"] is not None]
        series.append({
            "origin": origin,
            "origin_level": group["origin_level"].iloc[0],
            "points": points,
            "months_present": len(present),
            "months_missing": len(points) - len(present),
        })
    order = {o: i for i, o in enumerate(origins)}
    series.sort(key=lambda s: order.get(s["origin"], 999))
    return {"months": grid, "series": series, "geography": geography, "metric": metric, "unit": unit,
            "source": source}


def origin_comparison(conn: sqlite3.Connection, geography: str, metric: str, unit: str, source: str,
                      month: str | None = None, level: str = "country") -> dict:
    """Compare origins for one month: value, share of the total, YoY change. Missing stays missing."""
    if month is None:
        month = conn.execute(
            "SELECT MAX(reporting_month) FROM visitor_stats WHERE geography=? AND metric=? AND unit=? AND source=?",
            (geography, metric, unit, source)).fetchone()[0]
    if month is None:
        return {"month": None, "rows": [], "total": None}
    ly = same_month_last_year(month)
    data = rows(conn.execute(
        """SELECT cur.visitor_origin, cur.origin_level, cur.value, cur.value_status, cur.evidence_id,
                  prev.value AS value_last_year, prev.evidence_id AS evidence_id_last_year
           FROM visitor_stats cur
           LEFT JOIN visitor_stats prev
             ON prev.geography = cur.geography AND prev.metric = cur.metric AND prev.unit = cur.unit
            AND prev.source = cur.source AND prev.visitor_origin = cur.visitor_origin AND prev.reporting_month = ?
           WHERE cur.geography = ? AND cur.metric = ? AND cur.unit = ? AND cur.source = ? AND cur.reporting_month = ?""",
        (ly, geography, metric, unit, source, month)))
    total_row = next((r for r in data if r["origin_level"] == "total"), None)
    total = total_row["value"] if total_row else None
    out = []
    for r in data:
        if level != "all" and r["origin_level"] != level:
            continue
        out.append({**r, "share_of_total_pct": share(r["value"], total),
                    "yoy": pct_change(r["value"], r["value_last_year"])})
    out.sort(key=lambda r: r["value"], reverse=True)
    return {"month": month, "comparison_month": ly, "total": total,
            "total_evidence_id": total_row["evidence_id"] if total_row else None,
            "rows": out, "comparable_count": sum(1 for r in out if r["yoy"]["status"] == "ok")}


def key_trends(conn: sqlite3.Connection, top_n: int = 5) -> list[dict]:
    """Headline facts for each visitor-stats series: latest total and largest YoY movers."""
    facts = []
    for s in series_catalog(conn):
        cmp = origin_comparison(conn, s["geography"], s["metric"], s["unit"], s["source"])
        if cmp["month"] is None:
            continue
        movers = sorted((r for r in cmp["rows"] if r["yoy"]["status"] == "ok"),
                        key=lambda r: r["yoy"]["value"], reverse=True)
        facts.append({
            **s,
            "latest_month": cmp["month"],
            "comparison_month": cmp["comparison_month"],
            "total": cmp["total"],
            "total_evidence_id": cmp["total_evidence_id"],
            "total_yoy": _total_yoy(conn, s, cmp["month"]),
            "comparable_origins": cmp["comparable_count"],
            "country_rows": len(cmp["rows"]),
            "top_growth": movers[:top_n],
            "top_decline": list(reversed(movers[-top_n:])) if len(movers) > top_n else [],
            "largest": cmp["rows"][:top_n],
        })
    return facts


def _total_yoy(conn, s: dict, month: str) -> dict:
    vals = dict(conn.execute(
        """SELECT reporting_month, value FROM visitor_stats WHERE geography=? AND metric=? AND unit=? AND source=?
           AND origin_level='total' AND reporting_month IN (?, ?)""",
        (s["geography"], s["metric"], s["unit"], s["source"], month, same_month_last_year(month))).fetchall())
    return pct_change(vals.get(month), vals.get(same_month_last_year(month)))


# ---------------------------------------------------------------- competitors

def competitor_summary(conn: sqlite3.Connection) -> dict:
    """Price/duration statistics. Missing prices are excluded and the sample size is reported."""
    df = pd.read_sql_query("SELECT * FROM competitor_offers", conn)
    if df.empty:
        return {"offers": 0, "businesses": 0, "by_currency": [], "by_language": [], "missing_price": 0}
    latest = (df.sort_values("date_observed")
                .groupby(["business", "tour_name", "language"], as_index=False).tail(1))
    priced = latest.dropna(subset=["price"])
    by_currency = []
    for currency, g in priced.groupby("currency"):
        by_currency.append({
            "currency": currency, "n": int(len(g)),
            "min": float(g["price"].min()), "median": float(g["price"].median()), "max": float(g["price"].max()),
            "evidence_ids": g["evidence_id"].tolist(),
        })
    by_language = [{"language": lang, "offers": int(len(g)), "share_pct": share(len(g), len(latest))}
                   for lang, g in latest.groupby("language")]
    durations = latest["duration_minutes"].dropna()
    return {
        "observations": int(len(df)),
        "offers": int(len(latest)),  # latest observation per business/tour/language
        "businesses": int(latest["business"].nunique()),
        "missing_price": int(latest["price"].isna().sum()),
        "missing_duration": int(latest["duration_minutes"].isna().sum()),
        "duration_median_minutes": float(durations.median()) if len(durations) else None,
        "duration_n": int(len(durations)),
        "by_currency": by_currency,
        "by_language": sorted(by_language, key=lambda r: -r["offers"]),
        "observed_from": df["date_observed"].min(),
        "observed_to": df["date_observed"].max(),
    }


# ---------------------------------------------------------------- feedback

def theme_summary(conn: sqlite3.Connection, method: str | None = None, examples_per_theme: int = 3) -> dict:
    """Theme counts with the denominator (feedback items classified by that method) made explicit."""
    total_feedback = conn.execute("SELECT COUNT(*) FROM feedback").fetchone()[0]
    if method is None:  # prefer language-model labels, then the local trained model, else keyword rules
        present = {r[0] for r in conn.execute("SELECT DISTINCT method FROM feedback_themes")}
        method = next((m for m in ("llm", "local") if m in present), "keyword")
    classified = conn.execute("SELECT COUNT(DISTINCT evidence_id) FROM feedback_themes WHERE method = ?",
                              (method,)).fetchone()[0]
    theme_rows = rows(conn.execute(
        """SELECT theme, COUNT(DISTINCT evidence_id) AS count,
                  SUM(sentiment='negative') AS negative, SUM(sentiment='positive') AS positive,
                  SUM(sentiment='mixed') AS mixed
           FROM feedback_themes WHERE method = ? GROUP BY theme ORDER BY count DESC""", (method,)))
    for t in theme_rows:
        t["share_pct"] = share(t["count"], classified)
        t["examples"] = rows(conn.execute(
            """SELECT f.evidence_id, f.text, f.language, f.source, f.rating, f.publication_date, f.collection_date,
                      ft.sentiment
               FROM feedback_themes ft JOIN feedback f USING (evidence_id)
               WHERE ft.method = ? AND ft.theme = ?
               ORDER BY f.collection_date DESC, f.evidence_id LIMIT ?""",
            (method, t["theme"], examples_per_theme)))
    return {"method": method, "total_feedback": total_feedback, "classified": classified,
            "unclassified": total_feedback - classified, "themes": theme_rows}


# ---------------------------------------------------------------- coverage

DATASET_DATES = {
    "visitor_stats": ("reporting_month", "reporting period"),
    "competitor_offers": ("date_observed", "observation date"),
    "feedback": ("collection_date", "collection date"),
    "news": ("publication_date", "publication date"),
}


def coverage(conn: sqlite3.Connection) -> list[dict]:
    out = []
    for table, (date_col, date_label) in DATASET_DATES.items():
        stats = conn.execute(f"SELECT COUNT(*), MIN({date_col}), MAX({date_col}) FROM {table}").fetchone()
        last_ok = conn.execute(
            "SELECT MAX(completed_at) FROM import_batches WHERE dataset = ? AND status = 'success'", (table,)
        ).fetchone()[0]
        sources = [r[0] for r in conn.execute(
            f"SELECT DISTINCT {'publisher' if table == 'news' else 'source'} FROM {table} LIMIT 20")]
        out.append({"dataset": table, "records": stats[0], "date_field": date_label,
                    "from": stats[1], "to": stats[2], "last_successful_import": last_ok, "sources": sources})
    return out
