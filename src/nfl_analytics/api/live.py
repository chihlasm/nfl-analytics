"""Live scores while games are on, from ESPN's public scoreboard.

nflverse (our database) posts final scores an hour or two after each game but
has no in-progress scores. This module fills that gap: a background thread
polls ESPN's scoreboard every 30 seconds while a game is live, every minute
around kickoff, and every 15 minutes otherwise, and keeps the result in memory
(like the headlines), so the ingest service stays the database's only writer.

The feed is unofficial, so it is treated as a bonus: anything unexpected in it
is skipped, a failed fetch keeps the last good result, live data older than 10
minutes is never shown, and a game nflverse already has as final always shows
nflverse's score.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from nfl_analytics.api import models as m

log = logging.getLogger(__name__)

EASTERN = ZoneInfo("America/New_York")
TIMEOUT = httpx.Timeout(10.0)
MAX_BYTES = 4 * 1024 * 1024
USER_AGENT = "nfl-analytics/0.1 (personal scoreboard)"
STALE_AFTER = timedelta(minutes=10)
LIVE_EVERY = 30.0
KICKOFF_EVERY = 60.0
IDLE_EVERY = 15 * 60.0
KICKOFF_WINDOW = timedelta(minutes=20)
MAX_TEXT = 300

# ESPN abbreviations that differ from nflverse's.
ESPN_TO_NFLVERSE = {"WSH": "WAS", "LAR": "LA"}
STATES = frozenset({"pre", "in", "post"})


@dataclass(frozen=True, slots=True)
class LiveGame:
    away: str
    home: str
    local_date: date  # kickoff date in US Eastern, as nflverse records it
    kickoff: datetime
    status: m.LiveStatus


def _text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    text = " ".join(value.split())
    return text[:MAX_TEXT] or None


def _int(value: Any) -> int | None:
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return None


def _team(competitor: dict[str, Any]) -> str | None:
    abbr = _text((competitor.get("team") or {}).get("abbreviation"))
    return ESPN_TO_NFLVERSE.get(abbr, abbr) if abbr else None


def parse_scoreboard(data: Any, fetched_at: datetime) -> list[LiveGame]:
    """Games from an ESPN scoreboard response. Malformed events are skipped."""
    games: list[LiveGame] = []
    events = data.get("events") if isinstance(data, dict) else None
    for event in events if isinstance(events, list) else []:
        try:
            game = _parse_event(event, fetched_at)
        except (KeyError, TypeError, ValueError, IndexError, AttributeError):
            game = None
        if game is not None:
            games.append(game)
    return games


def _parse_event(event: dict[str, Any], fetched_at: datetime) -> LiveGame | None:
    competition = event["competitions"][0]
    sides = {c.get("homeAway"): c for c in competition["competitors"]}
    away, home = _team(sides["away"]), _team(sides["home"])
    if not away or not home:
        return None
    kickoff = datetime.fromisoformat(str(event["date"]).replace("Z", "+00:00"))
    status = competition.get("status") or event.get("status") or {}
    kind = status.get("type") or {}
    state = kind.get("state")
    if state not in STATES:
        return None

    ids = {str(c["team"]["id"]): _team(c) for c in sides.values() if c.get("team")}
    situation = competition.get("situation") or {}
    live = state == "in"
    detail = _text(kind.get("shortDetail")) or _text(kind.get("detail")) or state
    return LiveGame(
        away=away,
        home=home,
        local_date=kickoff.astimezone(EASTERN).date(),
        kickoff=kickoff,
        status=m.LiveStatus(
            state=state,
            detail=detail,
            period=_int(status.get("period")) if state != "pre" else None,
            clock=_text(status.get("displayClock")) if live else None,
            away_score=_int(sides["away"].get("score")) if state != "pre" else None,
            home_score=_int(sides["home"].get("score")) if state != "pre" else None,
            possession=ids.get(str(situation.get("possession"))) if live else None,
            down_distance=_text(situation.get("downDistanceText")) if live else None,
            red_zone=bool(situation.get("isRedZone")) if live else False,
            last_play=_text((situation.get("lastPlay") or {}).get("text")) if live else None,
            is_overtime="OT" in detail.upper(),
            updated_at=fetched_at,
        ),
    )


def next_delay(games: list[LiveGame], now: datetime) -> float:
    """How long to wait before the next poll: quick while anything is on."""
    if any(g.status.state == "in" for g in games):
        return LIVE_EVERY
    # Around kickoff, or past it but not started yet (a delayed start).
    if any(g.status.state == "pre" and g.kickoff - now <= KICKOFF_WINDOW for g in games):
        return KICKOFF_EVERY
    return IDLE_EVERY


@dataclass
class LiveScores:
    url: str
    client: httpx.Client | None = None
    _lock: threading.Lock = field(default_factory=threading.Lock)
    _games: list[LiveGame] = field(default_factory=list)
    _fetched_at: datetime | None = None
    _stop: threading.Event = field(default_factory=threading.Event)
    _thread: threading.Thread | None = None

    @property
    def enabled(self) -> bool:
        return bool(self.url)

    def refresh(self, now: datetime | None = None) -> list[LiveGame]:
        """Fetch once. On failure keep the last good result (it expires on its own)."""
        now = now or datetime.now(UTC)
        client = self.client or httpx.Client(
            timeout=TIMEOUT, follow_redirects=True, headers={"User-Agent": USER_AGENT}
        )
        try:
            response = client.get(self.url)
            response.raise_for_status()
            if len(response.content) > MAX_BYTES:
                raise ValueError(f"scoreboard larger than {MAX_BYTES} bytes")
            games = parse_scoreboard(response.json(), now)
        finally:
            if self.client is None:
                client.close()
        with self._lock:
            self._games = games
            self._fetched_at = now
        return games

    def current(self, now: datetime | None = None) -> list[LiveGame]:
        """The latest games, or nothing if the last good fetch is too old to trust."""
        now = now or datetime.now(UTC)
        with self._lock:
            if self._fetched_at is None or now - self._fetched_at > STALE_AFTER:
                return []
            return list(self._games)

    def apply(self, week: m.Week, now: datetime | None = None) -> m.Week:
        """Overlay live scores on a week of games from the database.

        nflverse stays authoritative: a game it has as final is left alone. A game
        ESPN shows as live or finished gets ESPN's score and a `live` status until
        nflverse posts the final.
        """
        games = self.current(now)
        if not games:
            return week
        by_key = {(g.away, g.home, g.local_date): g for g in games}
        out: list[m.Game] = []
        for game in week.games:
            live = (
                by_key.get((game.away.team, game.home.team, game.game_date))
                if game.game_date is not None
                else None
            )
            if game.is_final or live is None or live.status.state == "pre":
                out.append(game)
                continue
            s = live.status
            out.append(
                game.model_copy(
                    update={
                        "away": game.away.model_copy(update={"score": s.away_score}),
                        "home": game.home.model_copy(update={"score": s.home_score}),
                        "is_final": s.state == "post",
                        "is_overtime": s.is_overtime,
                        "live": s,
                    }
                )
            )
        return week.model_copy(update={"games": out})

    def _loop(self) -> None:
        while not self._stop.is_set():
            delay = IDLE_EVERY
            try:
                delay = next_delay(self.refresh(), datetime.now(UTC))
            except Exception as exc:
                # A blip: try again soon if games might be on, else on the idle schedule.
                log.warning("Live scores fetch failed: %s", exc)
                delay = KICKOFF_EVERY if self.current() else IDLE_EVERY
            self._stop.wait(delay)

    def start(self) -> None:
        if self.enabled and self._thread is None:
            self._thread = threading.Thread(target=self._loop, name="live-scores", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()
