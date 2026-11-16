"""NFL headlines from public RSS feeds, refreshed every 15 minutes in the background.

Only the headline, source, time and link are kept. Article text is never stored or
shown. Feeds are parsed with defusedxml (safe against malicious XML), titles are
treated as plain text, and only http(s) links are accepted. A feed that fails is
skipped and reported, so one broken source never empties the page.

Headlines live in memory: they are cheap to re-fetch, and keeping them out of the
database keeps the ingest service the database's only writer.
"""

from __future__ import annotations

import email.utils
import html
import logging
import os
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime
from xml.etree.ElementTree import Element

import httpx
from defusedxml import ElementTree

from nfl_analytics.api import models as m

log = logging.getLogger(__name__)

REFRESH_SECONDS = 15 * 60
MAX_ITEMS = 60
MAX_TITLE = 300
FEED_TIMEOUT = httpx.Timeout(10.0)
USER_AGENT = "nfl-analytics/0.1 (personal news reader)"

# Name|URL pairs. These are well-known public feeds but were not reachable from the
# build environment, so check `sources_failed` in /api/news after deploying and
# adjust NFL_NEWS_FEEDS if any are dead.
DEFAULT_FEEDS = (
    "ESPN|https://www.espn.com/espn/rss/nfl/news",
    "CBS Sports|https://www.cbssports.com/rss/headlines/nfl/",
    "Yahoo Sports|https://sports.yahoo.com/nfl/rss/",
    "Pro Football Talk|https://www.nbcsports.com/profootballtalk.rss",
)

ATOM = "{http://www.w3.org/2005/Atom}"
_TAG_RE = re.compile(r"<[^>]+>")
_SPACE_RE = re.compile(r"\s+")


@dataclass(frozen=True, slots=True)
class Feed:
    name: str
    url: str


def parse_feed_config(raw: str | None) -> list[Feed]:
    entries = [e.strip() for e in (raw or "").split(",") if e.strip()] or list(DEFAULT_FEEDS)
    feeds: list[Feed] = []
    for entry in entries:
        name, sep, url = entry.partition("|")
        if not sep or not url.startswith(("http://", "https://")):
            raise ValueError(f"NFL_NEWS_FEEDS entry {entry!r} must look like 'Name|https://...'")
        feeds.append(Feed(name.strip(), url.strip()))
    return feeds


def _clean_title(raw: str | None) -> str:
    text = html.unescape(_TAG_RE.sub("", raw or ""))
    return _SPACE_RE.sub(" ", text).strip()[:MAX_TITLE]


def _parse_date(raw: str | None) -> datetime | None:
    if not raw:
        return None
    raw = raw.strip()
    try:
        dt = email.utils.parsedate_to_datetime(raw)  # RSS: RFC 822
    except (TypeError, ValueError):
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))  # Atom: ISO 8601
        except ValueError:
            return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def _text(el: Element | None) -> str | None:
    """All text inside an element, including text inside stray child markup."""
    return "".join(el.itertext()) if el is not None else None


def parse_items(xml_bytes: bytes, source: str) -> list[m.NewsItem]:
    root = ElementTree.fromstring(xml_bytes)
    items: list[m.NewsItem] = []
    for it in root.iter("item"):  # RSS 2.0
        title = _clean_title(_text(it.find("title")))
        link = (_text(it.find("link")) or "").strip()
        published = _parse_date(_text(it.find("pubDate")))
        if title and link.startswith(("http://", "https://")):
            items.append(m.NewsItem(title=title, url=link, source=source, published_at=published))
    for entry in root.iter(f"{ATOM}entry"):  # Atom
        title = _clean_title(_text(entry.find(f"{ATOM}title")))
        link_el = entry.find(f"{ATOM}link")
        link = (link_el.get("href", "") if link_el is not None else "").strip()
        published = _parse_date(
            _text(entry.find(f"{ATOM}published")) or _text(entry.find(f"{ATOM}updated"))
        )
        if title and link.startswith(("http://", "https://")):
            items.append(m.NewsItem(title=title, url=link, source=source, published_at=published))
    return items


@dataclass
class NewsCache:
    feeds: list[Feed]
    client: httpx.Client | None = None
    _lock: threading.Lock = field(default_factory=threading.Lock)
    _snapshot: m.News = field(
        default_factory=lambda: m.News(items=[], fetched_at=None, sources_ok=[], sources_failed=[])
    )
    _stop: threading.Event = field(default_factory=threading.Event)
    _thread: threading.Thread | None = None

    def _fetch_one(self, client: httpx.Client, feed: Feed) -> list[m.NewsItem]:
        response = client.get(feed.url)
        response.raise_for_status()
        return parse_items(response.content, feed.name)

    def refresh(self) -> m.News:
        client = self.client or httpx.Client(
            timeout=FEED_TIMEOUT, follow_redirects=True, headers={"User-Agent": USER_AGENT}
        )
        ok: list[str] = []
        failed: list[str] = []
        items: list[m.NewsItem] = []
        try:
            with ThreadPoolExecutor(max_workers=max(1, len(self.feeds))) as pool:
                futures = {pool.submit(self._fetch_one, client, f): f for f in self.feeds}
                for future, feed in futures.items():
                    try:
                        items.extend(future.result())
                        ok.append(feed.name)
                    except Exception as exc:
                        log.warning("News feed %s failed: %s", feed.name, exc)
                        failed.append(feed.name)
        finally:
            if self.client is None:
                client.close()

        # Newest first; drop duplicate links and near-identical titles across sources.
        epoch = datetime.min.replace(tzinfo=UTC)
        items.sort(key=lambda i: i.published_at or epoch, reverse=True)
        seen: set[str] = set()
        unique: list[m.NewsItem] = []
        for item in items:
            key = item.url.split("?")[0].rstrip("/").lower()
            title_key = re.sub(r"[^a-z0-9]", "", item.title.lower())[:80]
            if key in seen or title_key in seen:
                continue
            seen.update({key, title_key})
            unique.append(item)

        snapshot = m.News(
            items=unique[:MAX_ITEMS],
            fetched_at=datetime.now(UTC),
            sources_ok=sorted(ok),
            sources_failed=sorted(failed),
        )
        with self._lock:
            # Keep the last good headlines if every feed failed this time.
            if snapshot.items or not self._snapshot.items:
                self._snapshot = snapshot
            else:
                self._snapshot = self._snapshot.model_copy(
                    update={"sources_ok": [], "sources_failed": sorted(failed)}
                )
        return self.snapshot()

    def snapshot(self) -> m.News:
        with self._lock:
            return self._snapshot

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self.refresh()
            except Exception:
                log.exception("News refresh failed")
            self._stop.wait(REFRESH_SECONDS)

    def start(self) -> None:
        if self._thread is None:
            self._thread = threading.Thread(target=self._loop, name="news", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()


def news_from_env() -> NewsCache:
    return NewsCache(feeds=parse_feed_config(os.environ.get("NFL_NEWS_FEEDS")))
