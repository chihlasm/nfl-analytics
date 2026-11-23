"""Live scores: parsing ESPN's scoreboard, polling pace, and how live data sits
on top of the database. Uses a synthetic scoreboard shaped like ESPN's."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from nfl_analytics.api import models as m
from nfl_analytics.api.app import create_app
from nfl_analytics.api.live import (
    IDLE_EVERY,
    KICKOFF_EVERY,
    LIVE_EVERY,
    LiveScores,
    next_delay,
    parse_scoreboard,
)
from nfl_analytics.api.news import NewsCache
from nfl_analytics.build import build_database
from nfl_analytics.config import Settings

NOW = datetime(2026, 11, 23, 2, 30, tzinfo=UTC)  # Sunday night, 9:30 PM Eastern


def side(abbr: str, team_id: str, score: str, where: str) -> dict[str, Any]:
    return {"homeAway": where, "score": score, "team": {"id": team_id, "abbreviation": abbr}}


def event(
    away: tuple[str, str, str],
    home: tuple[str, str, str],
    *,
    state: str,
    detail: str,
    kickoff: str = "2026-11-23T01:20Z",
    situation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "date": kickoff,
        "competitions": [
            {
                "competitors": [side(*home, "home"), side(*away, "away")],
                "status": {
                    "period": 2,
                    "displayClock": "7:34",
                    "type": {"state": state, "shortDetail": detail},
                },
                "situation": situation or {},
            }
        ],
    }


SNF = event(
    ("MIN", "16", "7"),
    ("SF", "25", "14"),
    state="in",
    detail="7:34 - 2nd",
    situation={
        "possession": "16",
        "downDistanceText": "3rd & 7 at SF 34",
        "isRedZone": False,
        "lastPlay": {"text": "  J.Jefferson   pass short right for 8 yards "},
    },
)
MNF = event(
    ("CIN", "4", "0"), ("WSH", "28", "0"), state="pre", detail="11/23 - 8:15 PM EST",
    kickoff="2026-11-24T01:15Z",
)  # fmt: skip
FINAL_OT = event(
    ("LAR", "14", "27"), ("SEA", "26", "24"), state="post", detail="Final/OT",
    kickoff="2026-11-22T21:25Z",
)  # fmt: skip


def scoreboard(*events: Any) -> dict[str, Any]:
    return {"events": list(events)}


def test_parses_live_game_with_situation() -> None:
    (game,) = parse_scoreboard(scoreboard(SNF), NOW)
    s = game.status
    assert (game.away, game.home, game.local_date) == ("MIN", "SF", date(2026, 11, 22))
    assert (s.state, s.detail, s.period, s.clock) == ("in", "7:34 - 2nd", 2, "7:34")
    assert (s.away_score, s.home_score) == (7, 14)
    assert s.possession == "MIN"  # ESPN's team id 16, turned into our code
    assert s.down_distance == "3rd & 7 at SF 34" and s.red_zone is False
    assert s.last_play == "J.Jefferson pass short right for 8 yards"  # tidied text


def test_maps_espn_team_codes_and_hides_pregame_scores() -> None:
    mnf, final = parse_scoreboard(scoreboard(MNF, FINAL_OT), NOW)
    assert (mnf.away, mnf.home) == ("CIN", "WAS")  # ESPN's WSH
    assert mnf.status.away_score is None and mnf.status.possession is None
    assert (final.away, final.status.is_overtime) == ("LA", True)  # ESPN's LAR


def test_skips_malformed_events() -> None:
    broken = [{"competitions": []}, {"date": "x"}, "nonsense", event(
        ("MIN", "16", "7"), ("SF", "25", "14"), state="weird", detail="?"
    )]  # fmt: skip
    assert parse_scoreboard(scoreboard(*broken, SNF), NOW)[0].away == "MIN"
    assert len(parse_scoreboard(scoreboard(*broken), NOW)) == 0
    assert parse_scoreboard({"no": "events"}, NOW) == []
    assert parse_scoreboard(["not", "a", "dict"], NOW) == []


def test_polls_fast_only_when_it_matters() -> None:
    live = parse_scoreboard(scoreboard(SNF, MNF), NOW)
    assert next_delay(live, NOW) == LIVE_EVERY
    pre = parse_scoreboard(scoreboard(MNF), NOW)
    assert next_delay(pre, NOW) == IDLE_EVERY  # kickoff is tomorrow
    assert next_delay(pre, datetime(2026, 11, 24, 1, 0, tzinfo=UTC)) == KICKOFF_EVERY
    late = datetime(2026, 11, 24, 1, 40, tzinfo=UTC)  # past kickoff, not started: delay
    assert next_delay(pre, late) == KICKOFF_EVERY
    assert next_delay(parse_scoreboard(scoreboard(FINAL_OT), NOW), NOW) == IDLE_EVERY


def week_of(*games: tuple[str, str, date, bool, int | None, int | None]) -> m.Week:
    return m.Week(
        season=2026,
        week=11,
        weeks=[11],
        games=[
            m.Game(
                game_id=f"2026_11_{away}_{home}",
                season=2026,
                week=11,
                game_type="REG",
                game_date=day,
                kickoff_time_et="20:20",
                home=m.TeamScore(team=home, score=hs, qb_name=None),
                away=m.TeamScore(team=away, score=as_, qb_name=None),
                is_final=final,
                is_overtime=False,
                spread_line=None,
                total_line=None,
                stadium=None,
                roof=None,
            )
            for away, home, day, final, as_, hs in games
        ],
    )


def scores(client_json: dict[str, Any]) -> httpx.MockTransport:
    return httpx.MockTransport(lambda _req: httpx.Response(200, json=client_json))


def live_with(*events: Any) -> LiveScores:
    live = LiveScores(url="https://example.test/scoreboard",
                      client=httpx.Client(transport=scores(scoreboard(*events))))  # fmt: skip
    live.refresh(NOW)
    return live


def test_overlays_live_scores_until_nflverse_has_the_final() -> None:
    live = live_with(SNF, FINAL_OT)
    week = week_of(
        ("MIN", "SF", date(2026, 11, 22), False, None, None),  # on now
        ("LA", "SEA", date(2026, 11, 22), False, None, None),  # over, nflverse not yet
        ("NYJ", "LAC", date(2026, 11, 22), True, 27, 24),  # nflverse final, no live entry
    )
    snf, rams, jets = live.apply(week, NOW).games
    assert (snf.away.score, snf.home.score, snf.is_final) == (7, 14, False)
    assert snf.live is not None and snf.live.detail == "7:34 - 2nd"
    assert (rams.away.score, rams.is_final, rams.is_overtime) == (27, True, True)
    assert jets.live is None and jets.away.score == 27


def test_nflverse_final_always_wins() -> None:
    live = live_with(SNF)
    week = week_of(("MIN", "SF", date(2026, 11, 22), True, 24, 21))
    (game,) = live.apply(week, NOW).games
    assert (game.away.score, game.home.score, game.live) == (24, 21, None)


def test_only_matches_the_same_date() -> None:
    live = live_with(SNF)  # a rematch earlier in the season must not pick this up
    week = week_of(("MIN", "SF", date(2026, 9, 14), False, None, None))
    assert live.apply(week, NOW).games[0].live is None


def test_stale_or_failed_feeds_show_nothing_live() -> None:
    live = live_with(SNF)
    week = week_of(("MIN", "SF", date(2026, 11, 22), False, None, None))
    later = NOW + timedelta(minutes=11)
    assert live.apply(week, later).games[0].live is None  # too old to trust

    calls = {"n": 0}

    def flaky(_req: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(200, json=scoreboard(SNF)) if calls["n"] == 1 else httpx.Response(503)

    live = LiveScores(
        url="https://example.test/s", client=httpx.Client(transport=httpx.MockTransport(flaky))
    )
    live.refresh(NOW)
    with pytest.raises(httpx.HTTPStatusError):
        live.refresh(NOW + timedelta(minutes=1))
    # The last good result stays until it goes stale.
    assert live.current(NOW + timedelta(minutes=2))[0].away == "MIN"
    assert live.current(NOW + timedelta(minutes=11)) == []


def test_disabled_without_a_url() -> None:
    live = LiveScores(url="")
    assert live.enabled is False
    live.start()  # does nothing
    assert live._thread is None


@pytest.fixture
def client(fixture_settings: Settings) -> Iterator[TestClient]:
    build_database(fixture_settings)
    # The fixture's only game (ATL at BAL, 2026-10-05) is final in nflverse.
    oct5 = event(("ATL", "1", "3"), ("BAL", "33", "0"), state="in", detail="Q1",
                 kickoff="2026-10-05T17:00Z")  # fmt: skip
    live = LiveScores(url="https://example.test/s",
                      client=httpx.Client(transport=scores(scoreboard(oct5))))  # fmt: skip
    live.refresh()
    app = create_app(fixture_settings, NewsCache(feeds=[]), start_news=False, live=live)
    with TestClient(app) as c:
        yield c


def test_api_keeps_final_scores_from_the_database(client: TestClient) -> None:
    (game,) = client.get("/api/games?season=2026&week=5").json()["games"]
    assert (game["away"]["score"], game["home"]["score"], game["live"]) == (20, 27, None)
