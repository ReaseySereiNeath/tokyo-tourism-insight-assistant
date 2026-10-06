import sqlite3
from functools import partial
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from app.analysis.themes import classify_with_keywords
from app.config import get_settings
from app.db import Scope, rows
from app.importers.datasets import DATASETS
from app.importers.feeds import FeedFetchError, fetch_feed, parse_feed
from app.importers.jnto import parse_jnto_monthly_workbook
from app.importers.jta import parse_jta_spending_workbook
from app.importers.service import get_batch, run_import
from app.importers.templates import column_guide, template_csv
from app.routers.deps import db, scope_param

router = APIRouter(prefix="/api/imports", tags=["imports"])

IMPORTERS = {
    "auto": "CSV or Excel file that follows the template",
    "jnto_monthly_xlsx": "JNTO monthly visitor arrivals workbook (XLSX, as downloaded from jnto.go.jp)",
    "jta_spending_xlsx": "Japan Tourism Agency spending workbook (集計表 or 都道府県別集計表, XLSX or XLS)",
}
# Which dataset each source-specific importer produces.
IMPORTER_DATASET = {"jnto_monthly_xlsx": "visitor_stats", "jta_spending_xlsx": "spending_stats"}
PARSERS = {"jnto_monthly_xlsx": parse_jnto_monthly_workbook, "jta_spending_xlsx": parse_jta_spending_workbook}


@router.get("/datasets")
def datasets():
    return {"datasets": [column_guide(name) for name in DATASETS], "importers": IMPORTERS}


@router.get("/templates/{dataset}", response_class=PlainTextResponse)
def template(dataset: str, example: bool = False):
    if dataset not in DATASETS:
        raise HTTPException(404, "Unknown dataset")
    return PlainTextResponse(template_csv(dataset, with_example=example), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{dataset}_template.csv"'})


@router.post("")
async def upload(dataset: str = Form(...), importer: str = Form("auto"), file: UploadFile = File(...),
                 scope: Scope = Depends(scope_param), conn: sqlite3.Connection = Depends(db)):
    if dataset not in DATASETS:
        raise HTTPException(400, f"Unknown dataset '{dataset}'")
    if importer not in IMPORTERS:
        raise HTTPException(400, f"Unknown importer '{importer}'")
    if importer in IMPORTER_DATASET and dataset != IMPORTER_DATASET[importer]:
        raise HTTPException(400, f"{IMPORTERS[importer]} can only be imported as "
                                 f"{DATASETS[IMPORTER_DATASET[importer]].label.lower()}.")
    limit = get_settings().max_upload_bytes
    content = await file.read(limit + 1)
    if len(content) > limit:
        raise HTTPException(413, f"File is larger than {limit // (1024 * 1024)} MB.")
    if not content:
        raise HTTPException(400, "The file is empty.")
    filename = Path(file.filename or "upload").name
    parser = PARSERS.get(importer)
    batch = run_import(conn, scope, dataset, filename, content, parser=parser)
    if dataset == "feedback" and batch["status"] == "success" and batch["rows_inserted"]:
        classify_with_keywords(conn)  # keep the offline theme labels current
    return batch


class FeedRequest(BaseModel):
    url: str
    publisher: str | None = None
    permission_confirmed: bool = False


@router.post("/news-feed")
def import_feed(req: FeedRequest, scope: Scope = Depends(scope_param), conn: sqlite3.Connection = Depends(db)):
    if not req.permission_confirmed:
        raise HTTPException(400, "Please confirm that this feed's terms permit you to store its headlines and excerpts.")
    try:
        content = fetch_feed(req.url)
    except FeedFetchError as exc:
        raise HTTPException(400, str(exc)) from exc
    host = urlparse(req.url).hostname or "feed"
    return run_import(conn, scope, "news", f"feed_{host}.xml", content,
                      parser=lambda c, _f: parse_feed(c, req.publisher))


@router.get("")
def list_batches(dataset: str | None = None, conn: sqlite3.Connection = Depends(db)):
    sql = ("SELECT id, dataset, importer, original_filename, status, rows_total, rows_inserted, rows_duplicate, "
           "rows_updated, started_at, completed_at, json_array_length(errors_json) AS error_count FROM import_batches")
    params = []
    if dataset:
        sql += " WHERE dataset = ?"
        params.append(dataset)
    return rows(conn.execute(sql + " ORDER BY id DESC LIMIT 200", params))


@router.get("/{batch_id}")
def batch_detail(batch_id: int, conn: sqlite3.Connection = Depends(db)):
    if not conn.execute("SELECT 1 FROM import_batches WHERE id = ?", (batch_id,)).fetchone():
        raise HTTPException(404, "Import not found")
    return get_batch(conn, batch_id)


@router.get("/{batch_id}/records")
def batch_records(batch_id: int, limit: int = Query(50, le=500), conn: sqlite3.Connection = Depends(db)):
    batch = conn.execute("SELECT dataset FROM import_batches WHERE id = ?", (batch_id,)).fetchone()
    if not batch:
        raise HTTPException(404, "Import not found")
    table = DATASETS[batch["dataset"]].table
    return rows(conn.execute(f"SELECT * FROM {table} WHERE batch_id = ? LIMIT ?", (batch_id, limit)))
