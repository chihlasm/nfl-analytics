"""Team stats, team Explorer and team plays. Fixture: one game, ATL 20 at BAL 27,
with eight ATL dropbacks (play 3 a spike, play 2 intercepted, play 8 a sack,
play 7 the only positive-EPA play, a 13-yard touchdown)."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from nfl_analytics.api import team_stats
from nfl_analytics.api.app import create_app
from nfl_analytics.api.news import NewsCache
from nfl_analytics.build import build_database
from nfl_analytics.config import Settings

EPAS = [-0.8, -0.6, -0.3, -0.9, -0.7, 1.4, -2.1]  # the seven scrimmage plays


@pytest.fixture
def client(fixture_settings: Settings) -> Iterator[TestClient]:
    build_database(fixture_settings)
    app = create_app(fixture_settings, NewsCache(feeds=[]), start_news=False)
    with TestClient(app) as c:
        yield c


def teams(client: TestClient, query: str) -> list[tuple[int, str, float]]:
    body = client.get(f"/api/explorer/teams?{query}").json()
    return [(r["rank"], r["team"], r["value"]) for r in body["rows"]]


def test_every_stat_has_both_sides_or_a_reason() -> None:
    keys = set(team_stats.TEAM_STATS_BY_KEY)
    assert len(keys) == len(team_stats.TEAM_STATS)  # no duplicate keys
    for stat in team_stats.TEAM_STATS:
        assert stat.side in ("offense", "defense")
        # Only points come from scores; everything else can list its plays.
        assert stat.from_scores == stat.key.startswith("points")


def test_catalog_lists_team_stats(client: TestClient) -> None:
    body = client.get("/api/stats").json()
    by_key = {s["key"]: s for s in body["team_stats"]}
    assert by_key["epa_per_play"]["group"] == "offense"
    assert by_key["epa_per_play_allowed"]["higher_is_better"] is False
    assert by_key["points_per_game"]["has_plays"] is False


def test_offense_and_defense_from_the_same_plays(client: TestClient) -> None:
    (rank, team, epa), = teams(client, "stat=epa_per_play")  # fmt: skip
    assert (rank, team, epa) == (1, "ATL", pytest.approx(sum(EPAS) / 7))
    assert teams(client, "stat=epa_per_play_allowed")[0][1:] == (
        "BAL",
        pytest.approx(sum(EPAS) / 7),
    )
    assert teams(client, "stat=success_rate")[0][2] == pytest.approx(1 / 7)
    assert teams(client, "stat=giveaways")[0][1:] == ("ATL", 1.0)
    assert teams(client, "stat=takeaways")[0][1:] == ("BAL", 1.0)
    assert teams(client, "stat=sacks")[0][1:] == ("BAL", 1.0)
    assert teams(client, "stat=sacks_taken")[0][1:] == ("ATL", 1.0)


def test_points_rank_and_order(client: TestClient) -> None:
    assert teams(client, "stat=points_per_game") == [(1, "BAL", 27.0), (2, "ATL", 20.0)]
    # Lower is better for points allowed: ATL allowed 27, BAL 20.
    assert teams(client, "stat=points_allowed_per_game") == [(1, "BAL", 20.0), (2, "ATL", 27.0)]
    # Worst first lists in reverse but keeps league ranks.
    assert teams(client, "stat=points_per_game&order=worst") == [(2, "ATL", 20.0), (1, "BAL", 27.0)]


def test_conference_filter_keeps_league_ranks(client: TestClient) -> None:
    assert teams(client, "stat=points_per_game&conference=NFC") == [(2, "ATL", 20.0)]


def test_team_plays(client: TestClient) -> None:
    body = client.get("/api/team-plays?team=BAL&stat=takeaways").json()
    assert (body["subject_team"], body["player"], body["value"], body["plays"]) == (
        "BAL",
        None,
        1.0,
        1,
    )
    (play,) = body["rows"]
    # From the defense's side: the opponent is the offense, and BAL was at home.
    assert (play["play_id"], play["opponent"], play["is_home"], play["tags"]) == (
        2,
        "ATL",
        True,
        ["INT"],
    )


def test_team_plays_rates_mark_the_counted_plays(client: TestClient) -> None:
    body = client.get("/api/team-plays?team=ATL&stat=success_rate").json()
    assert (body["plays"], body["counted"], body["value"]) == (7, 1, pytest.approx(1 / 7))
    assert [r["play_id"] for r in body["rows"] if r["counted"]] == [7]
    assert 3 not in [r["play_id"] for r in body["rows"]]  # the spike isn't a scrimmage play
    only = client.get("/api/team-plays?team=ATL&stat=success_rate&counted_only=true").json()
    assert [r["play_id"] for r in only["rows"]] == [7] and only["counted_only"] is True


def test_team_plays_by_week_and_biggest_first(client: TestClient) -> None:
    body = client.get("/api/team-plays?team=ATL&stat=epa_per_play&sort=value&limit=2").json()
    assert [r["value"] for r in body["rows"]] == [1.4, -0.3]
    weeks = {w["week"]: w for w in body["weeks"]}
    assert weeks[5]["plays"] == 5 and weeks[6]["value"] == pytest.approx((1.4 - 2.1) / 2)
    week6 = client.get("/api/team-plays?team=ATL&stat=epa_per_play&week=6").json()
    assert (week6["plays"], week6["value"]) == (2, pytest.approx((1.4 - 2.1) / 2))


def test_bad_team_requests(client: TestClient) -> None:
    assert client.get("/api/team-plays?team=ATL&stat=points_per_game").status_code == 404
    assert client.get("/api/team-plays?team=ATL&stat=bogus").status_code == 404
    assert client.get("/api/explorer/teams?stat=bogus").status_code == 404
    for bad in ("team=atl&stat=sacks", "team=ATL'--&stat=sacks", "team=ATL&stat=sacks&sort=x"):
        assert client.get(f"/api/team-plays?{bad}").status_code == 422, bad
    for bad in ("conference=AFCX", "order=up", "season_type=PRE"):
        assert client.get(f"/api/explorer/teams?{bad}").status_code == 422, bad
