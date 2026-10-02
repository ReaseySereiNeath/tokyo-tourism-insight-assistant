-- Tokyo Tourism Insight Assistant: SQLite schema.
-- The same schema is used by two separate database files:
--   data/real.db  -> your real imports
--   data/demo.db  -> clearly labeled synthetic demonstration data
--
-- Date vocabulary (kept distinct everywhere):
--   reporting_month   the period a statistic describes (YYYY-MM)
--   publication_date  when the source published the item (YYYY-MM-DD, may be unknown)
--   collection_date   when we obtained the item (YYYY-MM-DD)
--   date_observed     when a competitor offer was seen (YYYY-MM-DD)

CREATE TABLE IF NOT EXISTS sources (
    name          TEXT PRIMARY KEY,
    publisher     TEXT,
    url           TEXT,
    attribution   TEXT,           -- citation text the source asks for
    license_note  TEXT,           -- what we know about usage conditions
    access_method TEXT            -- e.g. 'manual download', 'RSS feed'
);

CREATE TABLE IF NOT EXISTS import_batches (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset           TEXT NOT NULL,           -- visitor_stats | competitor_offers | feedback | news
    importer          TEXT NOT NULL,           -- csv | excel | jnto_monthly_xlsx | rss
    original_filename TEXT,
    file_sha256       TEXT,
    raw_path          TEXT,                    -- preserved original file (never modified)
    status            TEXT NOT NULL,           -- success | rejected | failed
    rows_total        INTEGER NOT NULL DEFAULT 0,
    rows_inserted     INTEGER NOT NULL DEFAULT 0,
    rows_duplicate    INTEGER NOT NULL DEFAULT 0,
    rows_updated      INTEGER NOT NULL DEFAULT 0,
    errors_json       TEXT NOT NULL DEFAULT '[]',
    warnings_json     TEXT NOT NULL DEFAULT '[]',
    started_at        TEXT NOT NULL,
    completed_at      TEXT
);

CREATE TABLE IF NOT EXISTS visitor_stats (
    evidence_id      TEXT PRIMARY KEY,
    reporting_month  TEXT NOT NULL,            -- YYYY-MM
    geography        TEXT NOT NULL,            -- e.g. 'Japan' (national arrivals) or 'Tokyo'
    visitor_origin   TEXT NOT NULL,            -- e.g. 'United States', 'All origins'
    origin_level     TEXT NOT NULL DEFAULT 'country',  -- total | region | country | subregion | other
    metric           TEXT NOT NULL,            -- e.g. 'visitor_arrivals'
    value            REAL NOT NULL,
    unit             TEXT NOT NULL,            -- e.g. 'persons'
    value_status     TEXT NOT NULL DEFAULT 'unknown',  -- final | provisional | estimate | unknown
    source           TEXT NOT NULL,
    original_label   TEXT,                     -- label exactly as it appeared in the source file
    publication_date TEXT,
    collection_date  TEXT NOT NULL,
    batch_id         INTEGER NOT NULL REFERENCES import_batches(id),
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_vs_series ON visitor_stats(geography, metric, unit, visitor_origin, reporting_month);

-- Previous values when a re-import revises a statistic (e.g. estimate -> final).
CREATE TABLE IF NOT EXISTS revisions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    evidence_id TEXT NOT NULL,
    field       TEXT NOT NULL,
    old_value   TEXT,
    new_value   TEXT,
    batch_id    INTEGER NOT NULL,
    changed_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS competitor_offers (
    evidence_id      TEXT PRIMARY KEY,
    business         TEXT NOT NULL,
    tour_name        TEXT NOT NULL,
    area             TEXT,
    price            REAL,                     -- NULL = not published / unknown (never 0)
    currency         TEXT,
    duration_minutes REAL,                     -- NULL = unknown
    language         TEXT NOT NULL,
    url              TEXT,
    date_observed    TEXT NOT NULL,
    notes            TEXT,
    source           TEXT NOT NULL,
    batch_id         INTEGER NOT NULL REFERENCES import_batches(id),
    created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feedback (
    evidence_id      TEXT PRIMARY KEY,
    text             TEXT NOT NULL,
    language         TEXT NOT NULL,
    source           TEXT NOT NULL,
    rating           REAL,                     -- optional, NULL when not given
    permission_basis TEXT NOT NULL,            -- why you may use this text
    publication_date TEXT,
    collection_date  TEXT NOT NULL,
    batch_id         INTEGER NOT NULL REFERENCES import_batches(id),
    created_at       TEXT NOT NULL
);

-- Theme labels for feedback. 'method' records HOW a label was produced
-- (keyword rules vs. a language model) so the UI can say so honestly.
CREATE TABLE IF NOT EXISTS feedback_themes (
    evidence_id   TEXT NOT NULL REFERENCES feedback(evidence_id),
    theme         TEXT NOT NULL,
    method        TEXT NOT NULL,               -- keyword | llm
    model         TEXT,
    sentiment     TEXT,                        -- positive | negative | mixed | neutral | NULL
    classified_at TEXT NOT NULL,
    PRIMARY KEY (evidence_id, theme, method)
);

CREATE TABLE IF NOT EXISTS news (
    evidence_id      TEXT PRIMARY KEY,
    title            TEXT NOT NULL,
    excerpt          TEXT,                     -- only text you are permitted to store
    url              TEXT,
    publisher        TEXT NOT NULL,
    publication_date TEXT,
    collection_date  TEXT NOT NULL,
    source_type      TEXT NOT NULL DEFAULT 'manual',  -- manual | feed
    batch_id         INTEGER NOT NULL REFERENCES import_batches(id),
    created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS business_profile (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    data_json  TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at      TEXT NOT NULL,
    provider        TEXT NOT NULL,             -- anthropic | demo
    model           TEXT,
    is_example      INTEGER NOT NULL DEFAULT 0, -- 1 = demonstration output, NOT live AI analysis
    status          TEXT NOT NULL,             -- success | partial | failed
    evidence_json   TEXT NOT NULL,             -- the exact evidence pack the provider received
    result_json     TEXT,                      -- validated report
    validation_json TEXT NOT NULL DEFAULT '{}',
    error           TEXT
);
