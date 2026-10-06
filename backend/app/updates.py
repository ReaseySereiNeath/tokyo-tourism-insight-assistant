"""Check the official sources for new releases and import them.

For each source we fetch ONE public page, read the links to the published
workbooks, and download only files we have not imported yet. Every download
goes through the normal import pipeline (original kept, validated, de-duplicated,
revisions recorded), into the REAL database only.

    JNTO  https://www.jnto.go.jp/statistics/data/visitors-statistics/
          One workbook covering 2003 to date, replaced on each monthly release.
    JTA   https://www.mlit.go.jp/kankocho/tokei_hakusyo/gaikokujinshohidoko.html
          Quarterly national tables (集計表) and prefecture tables (都道府県別集計表).
          We read quarters from 2024-Q2 on: earlier files use the old survey design.

Both pages allow reuse with credit (JNTO's citation terms; MLIT's PDL1.0). No
robots.txt restricts these paths. Requests are few, sequential and identified.
"""
import json
import logging
import re
import sqlite3
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import urljoin

import httpx

from app.db import connect, rows, utcnow
from app.importers.jnto import parse_jnto_monthly_workbook
from app.importers.jta import QUARTER_BY_START, parse_jta_spending_workbook
from app.importers.service import run_import

log = logging.getLogger(__name__)

JNTO_PAGE = "https://www.jnto.go.jp/statistics/data/visitors-statistics/"
JTA_PAGE = "https://www.mlit.go.jp/kankocho/tokei_hakusyo/gaikokujinshohidoko.html"
USER_AGENT = "TokyoTourismInsightAssistant/0.2 (local research tool; checks for new statistics releases)"
FIRST_JTA_PERIOD = "2024-Q2"  # first quarter of the current survey design
MAX_DOWNLOAD_BYTES = 30 * 1024 * 1024
PAUSE_SECONDS = 1.0


@dataclass
class Release:
    source: str
    url: str
    label: str            # human-readable, also used as the import's file name
    dataset: str
    period: str | None = None
    publication_date: str | None = None


class UpdateError(Exception):
    pass


def _get(client: httpx.Client, url: str) -> bytes:
    try:
        r = client.get(url)
        r.raise_for_status()
    except httpx.HTTPError as exc:
        raise UpdateError(f"Could not download {url}: {exc}") from exc
    if len(r.content) > MAX_DOWNLOAD_BYTES:
        raise UpdateError(f"{url} is larger than expected ({len(r.content) // 1_000_000} MB); skipped.")
    return r.content


def _text(html: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html)).strip()


def jnto_releases(html: str) -> list[Release]:
    out = []
    for href, text in re.findall(r'<a[^>]+href="([^"]+\.xlsx)"[^>]*>(.*?)</a>', html, re.S):
        if "訪日外客数" in _text(text) and re.search(r"/(\d{8})_[^/]+\.xlsx$", href):
            name = href.rsplit("/", 1)[-1]
            out.append(Release("JNTO", urljoin(JNTO_PAGE, href), name, "visitor_stats"))
    return out[:1]  # the page links the one current workbook


def jta_releases(html: str) -> list[Release]:
    """Walk the 'past results' section: year <summary>, then table-type <summary>, then links per quarter."""
    start = html.find("これまでの調査結果を見る", html.find("これまでの調査結果を見る") + 1)
    section = html[start:] if start > 0 else html
    latest_pub = re.search(r"公表日[:：]\s*(\d{4})年(\d{1,2})月(\d{1,2})日", html)
    latest_pub_date = f"{latest_pub.group(1)}-{int(latest_pub.group(2)):02d}-{int(latest_pub.group(3)):02d}" \
        if latest_pub else None

    out: list[Release] = []
    year, table = None, None
    token = re.compile(r'<summary>(.*?)</summary>|<a[^>]+href="([^"]+\.(?:xlsx|xls))"[^>]*>(.*?)</a>', re.S)
    for m in token.finditer(section):
        if m.group(1) is not None:
            heading = _text(m.group(1))
            y = re.match(r"(\d{4})年", heading)
            if y:
                year, table = int(y.group(1)), None
            elif "都道府県別集計表" in heading:
                table = "prefecture"
            elif "集計表" in heading:
                table = "national"
            else:
                table = None
            continue
        href, text = m.group(2), _text(m.group(3))
        q = re.match(r"(\d{1,2})-\d{1,2}月期", text)
        if year is None or table is None or not q or int(q.group(1)) not in QUARTER_BY_START:
            continue  # calendar-year files and anything unexpected are skipped
        period = f"{year}-Q{QUARTER_BY_START[int(q.group(1))]}"
        if period < FIRST_JTA_PERIOD:
            continue
        name = href.rsplit("/", 1)[-1]
        stage = re.search(r"\((.*?速報|確報)\)", text)
        out.append(Release("JTA", urljoin(JTA_PAGE, href),
                           f"JTA {period} {'prefecture' if table == 'prefecture' else 'national'} tables"
                           f"{' ' + stage.group(1) if stage else ''} ({name})", "spending_stats", period))
    # The newest quarter's publication date is printed at the top of the page.
    if out and latest_pub_date:
        newest = max(r.period for r in out)
        for r in out:
            if r.period == newest:
                r.publication_date = latest_pub_date
    return out


def _already_imported(conn: sqlite3.Connection, release: Release) -> bool:
    return conn.execute("SELECT 1 FROM import_batches WHERE original_filename = ? AND status = 'success'",
                        (release.label,)).fetchone() is not None


def _import(conn: sqlite3.Connection, release: Release, content: bytes) -> dict:
    if release.source == "JNTO":
        parser = lambda c, f: parse_jnto_monthly_workbook(c, release.label)  # noqa: E731
    else:
        filename = release.url.rsplit("/", 1)[-1]
        parser = lambda c, f: parse_jta_spending_workbook(c, filename, publication_date=release.publication_date)  # noqa: E731
    return run_import(conn, "real", release.dataset, release.label, content, parser=parser)


def check_source(conn: sqlite3.Connection, client: httpx.Client, source: str) -> dict:
    page, finder = (JNTO_PAGE, jnto_releases) if source == "JNTO" else (JTA_PAGE, jta_releases)
    files: list[dict] = []
    try:
        releases = finder(_get(client, page).decode("utf-8", errors="replace"))
        if not releases:
            raise UpdateError(f"No data files were found on {page}. The page layout may have changed.")
        for release in sorted(releases, key=lambda r: r.period or ""):
            entry = {"label": release.label, "url": release.url, "period": release.period}
            if _already_imported(conn, release):
                files.append({**entry, "result": "already imported"})
                continue
            time.sleep(PAUSE_SECONDS)
            try:
                batch = _import(conn, release, _get(client, release.url))
            except UpdateError as exc:
                files.append({**entry, "result": "download failed", "message": str(exc)})
                continue
            files.append({**entry, "result": "imported" if batch["status"] == "success" else "rejected",
                          "batch_id": batch["id"], "rows_inserted": batch["rows_inserted"],
                          "rows_updated": batch["rows_updated"]})
        failed = [f for f in files if f["result"] in ("download failed", "rejected")]
        status, message = ("failed" if failed else "ok"), (f"{len(failed)} file(s) could not be imported." if failed else None)
    except UpdateError as exc:
        status, message = "failed", str(exc)
    conn.execute("INSERT INTO update_checks (checked_at, source, status, message, files_json) VALUES (?, ?, ?, ?, ?)",
                 (utcnow(), source, status, message, json.dumps(files, ensure_ascii=False)))
    conn.commit()
    return {"source": source, "status": status, "message": message, "files": files}


_lock = threading.Lock()


def check_all(conn: sqlite3.Connection | None = None, client: httpx.Client | None = None) -> list[dict]:
    """Check every source once. Only one check runs at a time."""
    if not _lock.acquire(blocking=False):
        raise UpdateError("A check is already running. Try again in a minute.")
    own_conn, own_client = conn is None, client is None
    conn = conn or connect("real")
    client = client or httpx.Client(timeout=60, follow_redirects=True, headers={"User-Agent": USER_AGENT})
    try:
        return [check_source(conn, client, s) for s in ("JNTO", "JTA")]
    finally:
        if own_client:
            client.close()
        if own_conn:
            conn.close()
        _lock.release()


def status(conn: sqlite3.Connection) -> dict:
    last = {r["source"]: {**r, "files": json.loads(r.pop("files_json"))} for r in rows(conn.execute(
        """SELECT * FROM update_checks u WHERE id = (SELECT MAX(id) FROM update_checks WHERE source = u.source)"""))}
    latest = {
        "visitor_month": conn.execute(
            "SELECT MAX(reporting_month) FROM visitor_stats WHERE source = 'JNTO'").fetchone()[0],
        "spending_period": conn.execute(
            "SELECT MAX(reporting_period) FROM spending_stats WHERE source = 'JTA' AND period_type = 'quarter'").fetchone()[0],
    }
    return {"last_checks": last, "latest": latest, "running": _lock.locked(),
            "schedule": {"JNTO": "Monthly, usually around the middle of the following month.",
                         "JTA": "Quarterly. A first estimate about a month after the quarter ends, revised later."}}


def due(conn: sqlite3.Connection, every_hours: float) -> bool:
    last = conn.execute("SELECT MAX(checked_at) FROM update_checks").fetchone()[0]
    if last is None:
        return True
    return datetime.now(timezone.utc) - datetime.fromisoformat(last) >= timedelta(hours=every_hours)


def start_scheduler(every_hours: float) -> threading.Thread | None:
    """Background thread: check when due, then every `every_hours`. 0 disables it."""
    if every_hours <= 0:
        return None

    def loop():
        while True:
            try:
                conn = connect("real")
                try:
                    if due(conn, every_hours):
                        check_all(conn)
                finally:
                    conn.close()
            except Exception:  # never let a failed check kill the app
                log.exception("Scheduled update check failed")
            time.sleep(min(every_hours * 3600, 3600))

    thread = threading.Thread(target=loop, name="update-checker", daemon=True)
    thread.start()
    return thread
