"""Team endpoints. Fixture: one 2026 week-5 game, ATL 20 at BAL 27 (BAL -3.5),
with eight ATL offensive plays (one spike, one interception)."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from nfl_analytics.api import teams
from nfl_analytics.api.app import create_app
from nfl_analytics.api.news import NewsCache
from nfl_analytics.build import build_database
from nfl_analytics.config import Settings


@pytest.fixture
def client(fixture_settings: Settings) -> Iterator[TestClient]:
    build_database(fixture_settings)
    app = create_app(fixture_settings, NewsCache(feeds=[]), start_news=False)
    with TestClient(app) as c:
        yield c


def test_standings_order_and_records(client: TestClient) -> None:
    body = client.get("/api/teams?season=2026").json()
    assert body["divisions_apply"] is True
    assert body["seasons"] == [2026]
    assert [r["info"]["team"] for r in body["teams"]] == ["BAL", "ATL"]
    bal, atl = body["teams"]
    assert (bal["record"]["wins"], bal["record"]["losses"], bal["record"]["home"]) == (1, 0, "1-0")
    assert atl["record"] == {
        "wins": 0,
        "losses": 1,
        "ties": 0,
        "points_for": 20,
        "points_against": 27,
        "home": "0-0",
        "away": "0-1",
        "division": "0-0",
        "streak": "L1",
    }
    assert atl["info"]["division"] == "NFC South"


def test_team_profile(client: TestClient) -> None:
    body = client.get("/api/teams/ATL").json()
    assert body["info"]["name"] == "Atlanta Falcons"
    assert body["season"] == 2026
    assert body["division_rank"] == 1
    assert [r["info"]["team"] for r in body["division"]] == ["ATL"]

    (game,) = body["games"]
    assert game["opponent"] == "BAL" and game["is_home"] is False
    assert (game["points_for"], game["points_against"], game["result"]) == (20, 27, "L")
    assert game["team_line"] == 3.5  # the away underdog; BAL sees -3.5
    bal_game = client.get("/api/teams/BAL").json()["games"][0]
    assert bal_game["team_line"] == -3.5 and bal_game["result"] == "W"

    leaders = {b["key"]: b["rows"] for b in body["leaders"]}
    passing = leaders["passing_yards"]
    assert {r["name"] for r in passing} == {"Michael Penix Jr.", "Drake London"}
    assert [r["value"] for r in passing] == sorted((r["value"] for r in passing), reverse=True)
    assert len(leaders["receiving_yards"]) <= teams.TEAM_LEADER_LIMIT

    assert body["injury_week"] == 6
    assert [i["player_name"] for i in body["injuries"]] == ["Michael Penix Jr."]
    assert client.get("/api/teams/BAL").json()["injuries"] == []


def test_ranks_exclude_spikes_and_rank_both_sides(client: TestClient) -> None:
    atl = {r["key"]: r for r in client.get("/api/teams/ATL").json()["ranks"]}
    # Seven scrimmage plays (the spike is left out): EPA -4.0 over 7.
    assert atl["epa_per_play"]["value"] == pytest.approx(-4.0 / 7)
    assert atl["giveaways"]["value"] == 1
    # ATL scored 20 to BAL's 27: second of two. Lower is better for points allowed.
    assert (atl["points_per_game"]["rank"], atl["points_per_game"]["teams"]) == (2, 2)
    assert atl["points_allowed_per_game"]["rank"] == 2

    bal = {r["key"]: r for r in client.get("/api/teams/BAL").json()["ranks"]}
    assert bal["takeaways"]["value"] == 1
    assert bal["epa_per_play_allowed"]["value"] == pytest.approx(-4.0 / 7)
    assert bal["points_allowed_per_game"]["rank"] == 1


def test_unknown_and_invalid_teams_404(client: TestClient) -> None:
    for path in ("/api/teams/NYJ", "/api/teams/atl", "/api/teams/ATLXX", "/api/teams/A%27--"):
        assert client.get(path).status_code == 404, path
    assert client.get("/api/teams?season=1800").status_code == 422


def test_season_without_games_falls_back_to_latest(client: TestClient) -> None:
    assert client.get("/api/teams/ATL?season=2025").json()["season"] == 2026


def test_record_streaks_and_ties() -> None:
    def g(week: int, result: str, home: bool = True, div: bool = False) -> dict[str, object]:
        pf, pa = {"W": (24, 10), "L": (10, 24), "T": (17, 17)}[result]
        return {
            "game_type": "REG",
            "week": week,
            "result": result,
            "is_home": home,
            "is_division_game": div,
            "points_for": pf,
            "points_against": pa,
        }

    rec = teams._record([g(3, "W"), g(1, "L", home=False), g(2, "T", div=True), g(4, "W")])
    assert (rec.wins, rec.losses, rec.ties) == (2, 1, 1)
    assert rec.streak == "W2"  # weeks 3 and 4, read in week order
    assert rec.home == "2-0-1" and rec.away == "0-1" and rec.division == "0-0-1"


def test_divisions_hidden_before_realignment() -> None:
    row = {"team": "SEA", "name": "Seattle Seahawks", "conference": "NFC", "division": "NFC West"}
    assert teams._info(row, 2001).division is None  # Seattle was in the AFC West then
    assert teams._info(row, 2002).division == "NFC West"
