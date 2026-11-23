"""The game page. Fixture: one final game, ATL 20 at BAL 27, whose play-by-play
has eight ATL dropbacks (a touchdown on play 7, a sack on play 8) in two drives:
a 3:00 punt drive and a 4:30 touchdown drive that reached the red zone."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import date

import duckdb
import pytest
from fastapi.testclient import TestClient

from nfl_analytics.api import games
from nfl_analytics.api import models as m
from nfl_analytics.api.app import create_app
from nfl_analytics.api.news import NewsCache
from nfl_analytics.build import build_database
from nfl_analytics.config import Settings
from tests.conftest import GAME


@pytest.fixture
def client(fixture_settings: Settings) -> Iterator[TestClient]:
    build_database(fixture_settings)
    app = create_app(fixture_settings, NewsCache(feeds=[]), start_news=False)
    with TestClient(app) as c:
        yield c


def recap(client: TestClient) -> dict:  # type: ignore[type-arg]
    body = client.get(f"/api/games/{GAME}").json()
    assert body["mode"] == "recap" and body["preview"] is None
    return body["recap"]  # type: ignore[no-any-return]


def test_quarters_end_at_the_official_final(client: TestClient) -> None:
    # The play-by-play has ATL 6, BAL 0; the official final (20-27) wins.
    assert recap(client)["quarters"] == [{"label": "1", "away": 20, "home": 27}]


def test_team_stats_box_and_advanced(client: TestClient) -> None:
    stats = {s["key"]: s for s in recap(client)["team_stats"]}
    assert stats["red_zone"]["away_text"] == "1/1"
    assert stats["possession"]["away_text"] == "7:30"
    assert stats["first_downs"]["away"] == 1.0
    # Totals add up: total yards are net passing plus rushing.
    total = stats["total_yards"]["away"]
    assert total == stats["pass_yards_per_game"]["away"] + (
        stats["rush_yards_per_game"]["away"] or 0
    )
    assert stats["pass_yards_per_game"]["label"] == "Net passing yards"
    # Advanced stats come from the team stat catalog for this game only, so they open plays.
    assert stats["epa_per_play"]["has_plays"] is True and stats["total_yards"]["has_plays"] is False
    assert stats["epa_per_play"]["away"] == pytest.approx(-4.0 / 7)
    # BAL ran no plays here, so there is nothing to compare and no edge.
    assert stats["epa_per_play"]["home"] is None and stats["epa_per_play"]["edge"] is None


def test_win_probability_and_key_plays(client: TestClient) -> None:
    r = recap(client)
    wp = r["win_probability"]
    assert wp[0] == {"t": 100, "home_wp": pytest.approx(0.49)}
    assert wp[-1]["home_wp"] == 1.0  # BAL won
    # The biggest swing: the sack (EPA -2.1, so -0.21 for ATL, +0.21 for BAL at home).
    first = r["key_plays"][0]
    assert (first["play_id"], first["team"]) == (8, "ATL")
    assert first["home_wp_change"] == pytest.approx(0.21)


def test_scoring_plays_use_the_final_score(client: TestClient) -> None:
    (td,) = recap(client)["scoring_plays"]
    assert (td["play_id"], td["kind"], td["team"]) == (7, "TD", "ATL")
    assert (td["away_score"], td["home_score"]) == (20, 27)


def test_player_lines(client: TestClient) -> None:
    groups = {g["key"]: g for g in recap(client)["players"]}
    passing = groups["passing"]
    assert [c["key"] for c in passing["columns"]][:3] == [
        "completions",
        "attempts",
        "passing_yards",
    ]
    # Sorted by passing yards: the fixture gives London 9 to Penix's 3 in week 5.
    assert [p["name"] for p in passing["away"]] == ["Drake London", "Michael Penix Jr."]
    # Lines split by team: BAL's player only shows on BAL's side (the fixture gives
    # every player a value in every stat).
    assert [p["name"] for p in passing["home"]] == ["Roquan Smith"]
    assert [p["name"] for p in groups["defense"]["home"]] == ["Roquan Smith"]


def test_unknown_games_404(client: TestClient) -> None:
    for bad in ("nope", "2026_05_ATL_XXX", "2026_5_ATL_BAL", "'; DROP TABLE x"):
        assert client.get(f"/api/games/{bad}").status_code == 404, bad


def test_preview_matchups_meetings_and_edges(fixture_settings: Settings) -> None:
    build_database(fixture_settings)
    con = duckdb.connect(str(fixture_settings.db_path), read_only=True)
    upcoming = m.Game(
        game_id="2026_12_ATL_BAL", season=2026, week=12, game_type="REG",
        game_date=date(2026, 11, 29), kickoff_time_et="13:00",
        home=m.TeamScore(team="BAL", score=None, qb_name=None),
        away=m.TeamScore(team="ATL", score=None, qb_name=None),
        is_final=False, is_overtime=False, spread_line=None, total_line=None,
        stadium=None, roof=None,
    )  # fmt: skip
    try:
        p = games._preview(con, upcoming)
    finally:
        con.close()
    assert p.stats_season == 2026 and p.stats_note is None
    assert (p.away_record.losses, p.home_record.wins) == (1, 1)  # type: ignore[union-attr]
    assert (p.away_form, p.home_form) == (["L"], ["W"])
    rows = {r.label: r for r in p.away_offense}
    # ATL scored 20 (2nd of 2); BAL allowed 20 (1st of 2): the defense has the edge.
    pts = rows["Points per game"]
    assert (pts.away_rank, pts.home_rank, pts.edge) == (2, 1, "home")
    assert (pts.away_key, pts.home_key) == ("points_per_game", "points_allowed_per_game")
    assert len(p.side_by_side) == 2 * len(games.MATCHUPS)
    (met,) = p.meetings
    assert (met.home, met.away_score, met.home_score, met.winner) == ("BAL", 20, 27, "BAL")
    passing = next(b for b in p.away_leaders if b.key == "passing_yards")
    assert "Michael Penix Jr." in [r.name for r in passing.rows]


def test_preview_falls_back_to_last_season_before_any_games(fixture_settings: Settings) -> None:
    build_database(fixture_settings)
    con = duckdb.connect(str(fixture_settings.db_path), read_only=True)
    game = m.Game(
        game_id="2027_01_ATL_BAL", season=2027, week=1, game_type="REG",
        game_date=date(2027, 9, 12), kickoff_time_et="13:00",
        home=m.TeamScore(team="BAL", score=None, qb_name=None),
        away=m.TeamScore(team="ATL", score=None, qb_name=None),
        is_final=False, is_overtime=False, spread_line=None, total_line=None,
        stadium=None, roof=None,
    )  # fmt: skip
    try:
        season, note = games._stats_season(con, game)
    finally:
        con.close()
    assert season == 2026 and note is not None and "2026" in note
