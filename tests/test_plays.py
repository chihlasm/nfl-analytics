"""Plays behind a number. Fixture plays (all Penix dropbacks, ATL at BAL):
1-2 short-throw misses (week 5; play 2 intercepted by Roquan Smith), 3 spike,
4 throwaway, 5 drop, 6 deep miss, 7 a 13-yard touchdown to London (week 6),
8 a sack by Roquan Smith (week 6)."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from nfl_analytics.api.app import create_app
from nfl_analytics.api.news import NewsCache
from nfl_analytics.build import build_database
from nfl_analytics.config import Settings
from tests.conftest import LB, QB, WR

EPAS = {1: -0.8, 2: -0.6, 4: -0.3, 5: -0.9, 6: -0.7, 7: 1.4, 8: -2.1}


@pytest.fixture
def client(fixture_settings: Settings) -> Iterator[TestClient]:
    build_database(fixture_settings)
    app = create_app(fixture_settings, NewsCache(feeds=[]), start_news=False)
    with TestClient(app) as c:
        yield c


def get(client: TestClient, query: str) -> dict:  # type: ignore[type-arg]
    r = client.get(f"/api/plays?{query}")
    assert r.status_code == 200, r.text
    return r.json()  # type: ignore[no-any-return]


def test_stat_plays_with_context_and_official_total(client: TestClient) -> None:
    body = get(client, f"player={QB}&stat=passing_tds")
    assert body["player"]["name"] == "Michael Penix Jr."
    assert (body["value"], body["plays"], body["counted"]) == (1.0, 1, 1)
    # The fixture's box score says 12; both numbers come back so the UI can show them.
    assert body["official"] == 12.0
    (play,) = body["rows"]
    assert (play["week"], play["opponent"], play["is_home"]) == (6, "BAL", False)
    assert (play["qtr"], play["down"], play["distance"], play["field"]) == (1, 1, 10, "ATL 25")
    assert play["tags"] == ["TD"] and play["description"] == "Play 7"
    assert body["weeks"] == [{"season_type": "REG", "week": 6, "plays": 1, "value": 1.0}]


def test_attempts_include_spikes_but_not_sacks(client: TestClient) -> None:
    body = get(client, f"player={QB}&stat=attempts")
    assert body["plays"] == 7
    assert 8 not in [r["play_id"] for r in body["rows"]]


def test_yards_and_week_filter(client: TestClient) -> None:
    body = get(client, f"player={QB}&stat=passing_yards")
    assert (body["value"], body["plays"]) == (13.0, 1)
    week5 = get(client, f"player={QB}&stat=passing_yards&week=5")
    assert (week5["plays"], week5["rows"], week5["week"]) == (0, [], 5)
    assert [w["week"] for w in week5["weeks"]] == [6]  # the picker still shows every week


def test_receiver_and_defender_sides(client: TestClient) -> None:
    td = get(client, f"player={WR}&stat=receiving_tds")
    assert (td["value"], td["rows"][0]["play_id"]) == (1.0, 7)
    sacks = get(client, f"player={LB}&stat=def_sacks")
    (play,) = sacks["rows"]
    # From the defender's side: the opponent is the offense, and BAL was at home.
    assert (sacks["value"], play["opponent"], play["is_home"], play["tags"]) == (
        1.0,
        "ATL",
        True,
        ["Sack"],
    )
    assert get(client, f"player={LB}&stat=def_interceptions")["rows"][0]["play_id"] == 2


def test_biggest_first_and_paging(client: TestClient) -> None:
    body = get(client, f"player={QB}&stat=passing_epa&sort=value&limit=2")
    # Passing EPA counts every pass play, the spike (-0.1) included, as nflverse does.
    assert [r["value"] for r in body["rows"]] == [1.4, -0.1]
    assert body["plays"] == 8 and body["value"] == pytest.approx(sum(EPAS.values()) - 0.1)
    page2 = get(client, f"player={QB}&stat=attempts&limit=2&offset=6")
    assert (len(page2["rows"]), page2["plays"], page2["offset"]) == (1, 7, 6)


def test_count_metric_lists_counted_plays_with_credit(client: TestClient) -> None:
    body = get(client, f"player={QB}&stat=short_throw_misses")
    assert body["stat"]["kind"] == "metric"
    assert body["stat"]["credit"] == "FTN Data via nflverse"
    assert (body["value"], body["plays"], body["counted"]) == (2.0, 2, 2)
    assert [r["play_id"] for r in body["rows"]] == [1, 2]
    assert body["official"] is None


def test_rate_metric_lists_the_whole_pool(client: TestClient) -> None:
    body = get(client, f"player={QB}&stat=short_throw_miss_rate")
    # Pool: pass attempts of 15 air yards or less (plays 1, 2, 4, 5, 7); misses: 1 and 2.
    assert [(r["play_id"], r["counted"]) for r in body["rows"]] == [
        (1, True),
        (2, True),
        (4, False),
        (5, False),
        (7, False),
    ]
    assert (body["plays"], body["counted"], body["value"]) == (5, 2, pytest.approx(0.4))
    only = get(client, f"player={QB}&stat=short_throw_miss_rate&counted_only=true")
    assert [r["play_id"] for r in only["rows"]] == [1, 2]


def test_average_metric_values_each_play(client: TestClient) -> None:
    body = get(client, f"player={QB}&stat=epa_per_dropback")
    assert {r["play_id"]: r["value"] for r in body["rows"]} == pytest.approx(EPAS)
    assert body["value"] == pytest.approx(sum(EPAS.values()) / 7)


def test_unknown_or_bad_requests(client: TestClient) -> None:
    assert client.get("/api/plays?player=00-9999999&stat=passing_tds").status_code == 404
    assert client.get(f"/api/plays?player={QB}&stat=bogus").status_code == 404
    for bad in ("team=atl", "sort=random", "limit=500", "season_type=PRE", "week=99"):
        r = client.get(f"/api/plays?player={QB}&stat=passing_tds&{bad}")
        assert r.status_code == 422, bad
    assert client.get("/api/plays?stat=passing_tds").status_code == 422  # player required


def test_explorer_ranks_advanced_stats(client: TestClient) -> None:
    misses = client.get("/api/explorer?stat=short_throw_misses").json()
    assert misses["stat"]["kind"] == "metric"
    assert [(r["name"], r["value"]) for r in misses["rows"]] == [("Michael Penix Jr.", 2.0)]

    # Rates need 50 qualifying plays by default; Penix has 5 here.
    rate = client.get("/api/explorer?stat=short_throw_miss_rate").json()
    assert (rate["min_plays"], rate["total"]) == (50, 0)
    rate = client.get("/api/explorer?stat=short_throw_miss_rate&min_plays=1").json()
    (row,) = rate["rows"]
    assert (row["value"], row["attempts"]) == (pytest.approx(0.4), 5)
    # Per game means nothing for a rate, so the ranking stays on the rate itself.
    assert (
        client.get("/api/explorer?stat=short_throw_miss_rate&sort=per_game").json()["sort"]
        == "total"
    )


def test_explorer_explains_seasons_before_charting(client: TestClient) -> None:
    body = client.get("/api/explorer?stat=short_throw_misses&season=2019").json()
    assert body["total"] == 0 and "2022" in body["note"]
