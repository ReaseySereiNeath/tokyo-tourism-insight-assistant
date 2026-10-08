"""SQLite access.

Two database files with an identical schema keep synthetic data physically
separate from real data:

    data/real.db   -> real imports (the default)
    data/demo.db   -> demonstration data only

Every API request names a `scope` ("real" or "demo"), and that scope picks
the file. Nothing ever reads from both, so demo rows cannot leak into real
analysis.
"""
import sqlite3
from collections.abc import Iterator
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from app.config import get_settings

Scope = Literal["real", "demo"]
SCOPES: tuple[Scope, ...] = ("real", "demo")

SCHEMA_PATH = Path(__file__).with_name("schema.sql")

# Known official sources, with what we verified about their usage conditions.
DEFAULT_SOURCES = [
    {
        "name": "JNTO",
        "publisher": "Japan National Tourism Organization",
        "url": "https://www.jnto.go.jp/statistics/data/visitors-statistics/",
        "attribution": "Source: Japan National Tourism Organization (JNTO)",
        "license_note": (
            "JNTO states figures may be cited if the source is credited as "
            "'日本政府観光局（JNTO）'; no notification needed. Its statistics portal "
            "asks for a Data Usage Application Form for published/media use. "
            "Figures are Japan-wide arrivals, NOT Tokyo visitors."
        ),
        "access_method": "Manual download of the monthly XLSX, then import",
    },
    {
        "name": "JTA",
        "publisher": "Japan Tourism Agency (観光庁), Ministry of Land, Infrastructure, Transport and Tourism",
        "url": "https://www.mlit.go.jp/kankocho/tokei_hakusyo/gaikokujinshohidoko.html",
        "attribution": "Source: Japan Tourism Agency, インバウンド消費動向調査 (Inbound Consumption Trend Survey)",
        "license_note": (
            "MLIT/JTA site content may be reused under the Public Data License (公共データ利用規約 PDL1.0) "
            "with the source credited, unless a page says otherwise. Quarterly figures are first published as "
            "preliminary (速報) and revised later; annual figures become final (確報). Survey-based estimates, "
            "not counts: small segments have few respondents."
        ),
        "access_method": "Download the quarterly 集計表 and 都道府県別集計表 workbooks, or use 'Check for new data'",
    },
    {
        "name": "Tokyo Tourism Data Catalog",
        "publisher": "Tokyo Metropolitan Government, Bureau of Industrial and Labor Affairs",
        "url": "https://data.tourism.metro.tokyo.lg.jp/en/",
        "attribution": "Source: Tokyo Metropolitan Government Tourism Data Catalog",
        "license_note": (
            "Formats and license terms were not stated on the catalog pages we checked. "
            "Confirm the terms on each dataset page before importing; use manual CSV import."
        ),
        "access_method": "Manual download, then CSV import",
    },
]


def utcnow() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def db_path(scope: Scope) -> Path:
    if scope not in SCOPES:
        raise ValueError(f"Unknown scope: {scope!r}")
    return get_settings().data_dir / f"{scope}.db"


def raw_dir(scope: Scope) -> Path:
    """Folder where original uploaded files are preserved untouched."""
    path = get_settings().data_dir / "raw" / scope
    path.mkdir(parents=True, exist_ok=True)
    return path


def connect(scope: Scope) -> sqlite3.Connection:
    path = db_path(scope)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    init_schema(conn)
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA_PATH.read_text())
    for s in DEFAULT_SOURCES:
        conn.execute(
            """INSERT OR IGNORE INTO sources (name, publisher, url, attribution, license_note, access_method)
               VALUES (:name, :publisher, :url, :attribution, :license_note, :access_method)""",
            s,
        )
    conn.commit()


def get_conn(scope: Scope) -> Iterator[sqlite3.Connection]:
    """FastAPI dependency helper: one connection per request."""
    conn = connect(scope)
    try:
        yield conn
    finally:
        conn.close()


def rows(cursor: sqlite3.Cursor) -> list[dict]:
    return [dict(r) for r in cursor.fetchall()]
