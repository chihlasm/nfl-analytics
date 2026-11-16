from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime

import httpx
import pytest
from fastapi.testclient import TestClient

from nfl_analytics.api.app import create_app
from nfl_analytics.api.models import NewsItem
from nfl_analytics.api.news import (
    MAX_PER_SOURCE,
    Feed,
    NewsCache,
    merge_headlines,
    parse_feed_config,
    parse_items,
)
from nfl_analytics.build import build_database
from nfl_analytics.config import Settings

from .conftest import QB, SEASON, WR

RSS = b"""<?xml version="1.0"?>
<rss version="2.0"><channel><title>Feed</title>
<item><title>Falcons &amp; <b>Penix</b> prep for Week 6</title>
  <link>https://example.com/a?utm=1</link><pubDate>Mon, 16 Nov 2026 12:00:00 GMT</pubDate>
  <description>Long article body that must never be stored.</description></item>
<item><title>Old story</title><link>https://example.com/b</link>
  <pubDate>Sun, 15 Nov 2026 08:00:00 GMT</pubDate></item>
<item><title>Bad link</title><link>javascript:alert(1)</link></item>
</channel></rss>"""

ATOM = b"""<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title>
<entry><title>Atom headline</title><link href="https://example.org/x"/>
  <updated>2026-11-16T13:00:00Z</updated></entry>
<entry><title>Falcons and Penix prep for Week 6</title><link href="https://example.com/a"/>
  <updated>2026-11-16T11:00:00Z</updated></entry>
</feed>"""


@pytest.fixture
def news() -> NewsCache:
    def handle(request: httpx.Request) -> httpx.Response:
        if "rss" in request.url.path:
            return httpx.Response(200, content=RSS)
        if "atom" in request.url.path:
            return httpx.Response(200, content=ATOM)
        return httpx.Response(500)

    client = httpx.Client(transport=httpx.MockTransport(handle))
    return NewsCache(
        feeds=[
            Feed("RSS", "https://feeds.test/rss"),
            Feed("Atom", "https://feeds.test/atom"),
            Feed("Down", "https://feeds.test/down"),
        ],
        client=client,
    )


@pytest.fixture
def client(fixture_settings: Settings, news: NewsCache) -> Iterator[TestClient]:
    build_database(fixture_settings)
    app = create_app(fixture_settings, news, start_news=False)
    with TestClient(app) as c:
        yield c


def test_meta_and_current_week(client: TestClient) -> None:
    body = client.get("/api/meta").json()
    assert body["latest_season"] == SEASON
    assert body["current_season"] == SEASON
    assert body["current_week"] == 5  # the fixture's only game is week 5 and final
    assert body["built_at"].endswith("Z") or "+00:00" in body["built_at"]


def test_games_for_week(client: TestClient) -> None:
    body = client.get("/api/games").json()
    assert body["week"] == 5 and body["weeks"] == [5]
    game = body["games"][0]
    assert game["away"] == {"team": "ATL", "score": 20, "qb_name": "M.Penix"}
    assert game["is_final"] is True
    # An unknown week falls back to the current week rather than erroring.
    assert client.get("/api/games?week=17").json()["week"] == 5


def test_leaders(client: TestClient) -> None:
    body = client.get("/api/leaders?limit=3").json()
    assert body["season"] == SEASON
    boards = {b["key"]: b for b in body["boards"]}
    assert next(iter(boards)) == "passing_yards"
    # passing_yards is STATS index 2 -> 3 * week weight; QB weeks weigh 1 and 2, WR 3.
    top = boards["passing_yards"]["rows"]
    assert [(r["name"], r["value"], r["games"]) for r in top] == [
        ("Drake London", 9.0, 1),
        ("Michael Penix Jr.", 9.0, 2),
    ]


def test_injuries(client: TestClient) -> None:
    body = client.get("/api/injuries").json()
    assert body["week"] == 6
    assert body["counts"]["Questionable"] == 1
    assert body["rows"][0]["player_name"] == "Michael Penix Jr."


def test_player_search_and_profile(client: TestClient) -> None:
    results = client.get("/api/players?q=penix").json()
    assert results[0]["player_id"] == QB  # most recent player first

    profile = client.get(f"/api/players/{QB}").json()
    assert profile["season"] == SEASON
    assert profile["columns"][0]["group"] == "passing"
    assert [w["week"] for w in profile["weeks"]] == [5, 6]
    assert profile["weeks"][1]["injury_status"] == "Questionable"
    metrics = {mv["name"]: mv for mv in profile["metrics"]}
    assert metrics["short_throw_misses"]["value"] == 2
    assert metrics["short_throw_miss_rate"]["denominator"] == 5

    wr = client.get(f"/api/players/{WR}").json()
    assert {mv["name"] for mv in wr["metrics"]} == {"receiver_drops"}


def test_validation_and_missing_player(client: TestClient) -> None:
    assert client.get("/api/players?q=a").status_code == 422
    assert client.get("/api/games?season=1990").status_code == 422
    assert client.get("/api/players/00-9999999").status_code == 404


def test_no_database_returns_503(settings: Settings, news: NewsCache) -> None:
    app = create_app(settings, news, start_news=False)
    with TestClient(app) as c:
        r = c.get("/api/meta")
    assert r.status_code == 503
    assert "not been built" in r.json()["detail"]


def test_api_follows_database_swaps(fixture_settings: Settings, news: NewsCache) -> None:
    build_database(fixture_settings)
    app = create_app(fixture_settings, news, start_news=False)
    with TestClient(app) as c:
        first = c.get("/api/meta").json()["built_at"]
        build_database(fixture_settings)
        second = c.get("/api/meta").json()["built_at"]
    assert second > first


def test_news_merges_dedupes_and_survives_a_dead_feed(news: NewsCache) -> None:
    snap = news.refresh()
    titles = [i.title for i in snap.items]
    # Newest first; the javascript: link dropped. The same story (same link) appears in
    # both feeds: the earlier-published copy (Atom, 11:00) is kept as the original.
    assert titles == ["Atom headline", "Falcons and Penix prep for Week 6", "Old story"]
    assert snap.items[1].source == "Atom"
    assert snap.sources_ok == ["Atom", "RSS"]
    assert snap.sources_failed == ["Down"]
    assert all(i.url.startswith("https://") for i in snap.items)


def test_news_keeps_last_good_headlines_when_all_feeds_fail(news: NewsCache) -> None:
    news.refresh()
    news.feeds = [Feed("Down", "https://feeds.test/down")]
    snap = news.refresh()
    assert len(snap.items) == 3
    assert snap.sources_failed == ["Down"]


def test_news_endpoint(client: TestClient, news: NewsCache) -> None:
    news.refresh()
    body = client.get("/api/news").json()
    assert body["items"][0]["source"] == "Atom"


def _item(title: str, source: str, minute: int | None, url: str | None = None) -> NewsItem:
    published = None if minute is None else datetime(2026, 11, 16, 12, minute, tzinfo=UTC)
    return NewsItem(
        title=title,
        url=url or f"https://{source.lower().replace(' ', '')}.test/{title.replace(' ', '-')}",
        source=source,
        published_at=published,
    )


def test_syndicated_copy_loses_to_the_original_outlet() -> None:
    original = _item("Penix limited at practice", "Pro Football Talk", 5)
    repost = _item("Penix limited at practice", "Yahoo Sports", 20)  # later, different link
    undated = _item("Penix limited at practice!", "Other", None)
    merged = merge_headlines([repost, undated, original])
    assert [(i.source, i.title) for i in merged] == [("Pro Football Talk", original.title)]


def test_each_source_is_capped_so_busy_feeds_cannot_crowd_out_others() -> None:
    busy = [_item(f"Yahoo story {n}", "Yahoo Sports", n) for n in range(40)]
    slow = [_item("CBS story", "CBS Sports", 0)]
    merged = merge_headlines(busy + slow)
    by_source = {s: sum(i.source == s for i in merged) for s in ("Yahoo Sports", "CBS Sports")}
    assert by_source == {"Yahoo Sports": MAX_PER_SOURCE, "CBS Sports": 1}
    # Yahoo keeps its newest stories; the result stays newest first.
    assert merged[0].title == "Yahoo story 39"
    assert merged[-1].source == "CBS Sports"


def test_parse_items_never_keeps_article_text() -> None:
    items = parse_items(RSS, "RSS")
    assert all("Long article" not in i.model_dump_json() for i in items)


def test_feed_config() -> None:
    assert parse_feed_config("A|https://a.test/rss, B|https://b.test/rss")[1].name == "B"
    assert len(parse_feed_config("")) >= 3  # defaults
    with pytest.raises(ValueError):
        parse_feed_config("no-url-here")
