"""Explorer. Fixture stat values are (catalog index % 7 + 1) x a weight per row:
Penix weeks 5 and 6 weigh 1 and 2 (REG) and a playoff week weighs 4; London's one
week weighs 3; Roquan Smith (BAL) weighs 1. passing_yards is index 2, so x3."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from nfl_analytics.api.app import create_app
from nfl_analytics.api.news import NewsCache
from nfl_analytics.api.stats import STATS
from nfl_analytics.build import build_database
from nfl_analytics.config import Settings


@pytest.fixture
def client(fixture_settings: Settings) -> Iterator[TestClient]:
    build_database(fixture_settings)
    app = create_app(fixture_settings, NewsCache(feeds=[]), start_news=False)
    with TestClient(app) as c:
        yield c


def rows(client: TestClient, query: str) -> list[tuple[int, str, float, int]]:
    body = client.get(f"/api/explorer?{query}").json()
    return [(r["rank"], r["name"], r["value"], r["games"]) for r in body["rows"]]


def test_catalog_lists_every_stat(client: TestClient) -> None:
    body = client.get("/api/stats").json()
    assert [s["key"] for s in body["stats"]] == [s.key for s in STATS]
    assert body["position_groups"] == ["QB", "RB", "WR", "TE", "DL", "LB", "DB"]


def test_ranks_regular_season_by_default(client: TestClient) -> None:
    body = client.get("/api/explorer?stat=passing_yards").json()
    assert body["stat"]["label"] == "Passing yards"
    assert (body["season_type"], body["sort"], body["order"], body["total"]) == (
        "REG",
        "total",
        "desc",
        3,
    )
    # London and Penix tie on 9; the better per-game figure ranks first.
    assert [(r["rank"], r["name"], r["value"], r["games"]) for r in body["rows"]] == [
        (1, "Drake London", 9.0, 1),
        (2, "Michael Penix Jr.", 9.0, 2),
        (3, "Roquan Smith", 3.0, 1),
    ]
    assert body["rows"][1]["per_game"] == 4.5


def test_season_type_playoffs_and_all(client: TestClient) -> None:
    assert rows(client, "stat=passing_yards&season_type=POST") == [
        (1, "Michael Penix Jr.", 12.0, 1)
    ]
    assert rows(client, "stat=passing_yards&season_type=ALL")[0] == (
        1,
        "Michael Penix Jr.",
        21.0,
        3,
    )


def test_filters_team_position_and_games(client: TestClient) -> None:
    assert [r[1] for r in rows(client, "stat=passing_yards&team=BAL")] == ["Roquan Smith"]
    assert [r[1] for r in rows(client, "stat=passing_yards&position=QB")] == ["Michael Penix Jr."]
    assert [r[1] for r in rows(client, "stat=passing_yards&min_games=2")] == ["Michael Penix Jr."]
    # An unknown position group is ignored rather than matching nothing.
    assert len(rows(client, "stat=passing_yards&position=XX")) == 3


def test_sort_per_game_and_ascending(client: TestClient) -> None:
    assert [r[1] for r in rows(client, "stat=passing_yards&order=asc")] == [
        "Roquan Smith",
        "Michael Penix Jr.",
        "Drake London",
    ]
    per_game = client.get("/api/explorer?stat=passing_yards&sort=per_game").json()["rows"]
    assert [r["per_game"] for r in per_game] == [9.0, 4.5, 3.0]


def test_paging_reports_total(client: TestClient) -> None:
    first = client.get("/api/explorer?stat=passing_yards&limit=2").json()
    second = client.get("/api/explorer?stat=passing_yards&limit=2&offset=2").json()
    assert (first["total"], len(first["rows"])) == (3, 2)
    assert [r["rank"] for r in second["rows"]] == [3] and second["offset"] == 2
    past = client.get("/api/explorer?stat=passing_yards&offset=50").json()
    assert past["rows"] == [] and past["total"] == 3


def test_rejects_unknown_stats_and_bad_input(client: TestClient) -> None:
    assert client.get("/api/explorer?stat=bogus").status_code == 404
    assert client.get("/api/explorer?stat=passing_yards;drop table x").status_code == 404
    for bad in ("team=atl", "team=ATL'--", "sort=name", "order=up", "limit=500", "season_type=PRE"):
        assert client.get(f"/api/explorer?stat=passing_yards&{bad}").status_code == 422, bad
