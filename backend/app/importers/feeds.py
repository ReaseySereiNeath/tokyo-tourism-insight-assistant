"""News from an RSS/Atom feed you are permitted to use.

We fetch ONE feed URL that the user supplies and confirms they may use.
No crawling, no following links, no login or paywall bypass. Only the
title, link, date and a short excerpt are stored. The raw feed XML is
preserved like any other import.
"""
import html
import re
from datetime import date

import feedparser
import httpx

from app.importers.common import ParseError, clean_text, normalize_url
from app.importers.service import ParsedFile, RowError

MAX_FEED_BYTES = 2 * 1024 * 1024
EXCERPT_CHARS = 500


class FeedFetchError(Exception):
    pass


def fetch_feed(url: str, timeout: float = 15.0) -> bytes:
    try:
        url = normalize_url(url)
    except ParseError as exc:
        raise FeedFetchError(str(exc)) from exc
    try:
        with httpx.Client(timeout=timeout, follow_redirects=True,
                          headers={"User-Agent": "TokyoTourismInsightAssistant/0.1 (personal research tool)"}) as client:
            with client.stream("GET", url) as response:
                if response.status_code in (401, 402, 403):
                    raise FeedFetchError(f"The feed requires access we do not have (HTTP {response.status_code}). "
                                         "Restricted content is not imported.")
                response.raise_for_status()
                chunks, size = [], 0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > MAX_FEED_BYTES:
                        raise FeedFetchError("The feed is larger than 2 MB; refusing to download it.")
                    chunks.append(chunk)
                return b"".join(chunks)
    except httpx.HTTPError as exc:
        raise FeedFetchError(f"Could not fetch the feed: {exc}") from exc


def _strip_html(text: str | None) -> str | None:
    if not text:
        return None
    return clean_text(html.unescape(re.sub(r"<[^>]+>", " ", text)))


def parse_feed(content: bytes, publisher: str | None = None) -> ParsedFile:
    result = ParsedFile(importer="rss")
    feed = feedparser.parse(content)
    if feed.bozo and not feed.entries:
        result.errors.append(RowError(None, None, "This does not look like a valid RSS/Atom feed."))
        return result
    publisher = clean_text(publisher) or clean_text(feed.feed.get("title")) or "Unknown publisher"
    today = date.today().isoformat()
    for i, entry in enumerate(feed.entries, start=1):
        title = _strip_html(entry.get("title"))
        if not title:
            result.warnings.append(f"Entry {i} has no title and was skipped.")
            continue
        published = entry.get("published_parsed") or entry.get("updated_parsed")
        excerpt = _strip_html(entry.get("summary"))
        try:
            url = normalize_url(entry.get("link"))
        except ParseError:
            url = None
        result.records.append({
            "title": title[:300],
            "excerpt": excerpt[:EXCERPT_CHARS] if excerpt else None,
            "url": url,
            "publisher": publisher,
            "publication_date": date(*published[:3]).isoformat() if published else None,
            "collection_date": today,
            "source_type": "feed",
            "_row": i,
        })
    if not result.records:
        result.errors.append(RowError(None, None, "The feed contained no usable entries."))
    return result
