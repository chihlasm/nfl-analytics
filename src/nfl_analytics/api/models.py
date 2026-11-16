"""Response shapes. These are the contract the frontend's TypeScript types mirror."""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel


class Meta(BaseModel):
    built_at: datetime
    latest_season: int | None
    latest_week: int | None
    current_season: int
    current_week: int | None


class TeamScore(BaseModel):
    team: str
    score: int | None
    qb_name: str | None


class Game(BaseModel):
    game_id: str
    season: int
    week: int
    game_type: str
    game_date: date | None
    kickoff_time_et: str | None
    home: TeamScore
    away: TeamScore
    is_final: bool
    is_overtime: bool
    spread_line: float | None
    total_line: float | None
    stadium: str | None
    roof: str | None


class Week(BaseModel):
    season: int
    week: int
    weeks: list[int]
    games: list[Game]


class LeaderRow(BaseModel):
    player_id: str
    name: str
    position: str | None
    team: str | None
    value: float
    games: int


class LeaderBoard(BaseModel):
    key: str
    label: str
    decimals: int
    rows: list[LeaderRow]


class Leaders(BaseModel):
    season: int
    through_week: int | None
    boards: list[LeaderBoard]


class InjuryRow(BaseModel):
    player_id: str | None
    player_name: str
    team: str
    position: str | None
    status: str
    injury: str | None
    practice_status: str | None


class Injuries(BaseModel):
    season: int
    week: int | None
    counts: dict[str, int]
    rows: list[InjuryRow]


class PlayerSummary(BaseModel):
    player_id: str
    display_name: str
    position: str | None
    position_group: str | None
    team: str | None
    last_season: int | None


class StatColumn(BaseModel):
    key: str
    label: str
    short: str
    group: str
    decimals: int


class WeekLine(BaseModel):
    season_type: str
    week: int
    team: str | None
    opponent: str | None
    snap_pct: float | None
    injury_status: str | None
    stats: dict[str, float | None]


class SeasonLine(BaseModel):
    season: int
    team: str | None
    games: int
    stats: dict[str, float | None]


class ThrowCell(BaseModel):
    """One cell of a QB's throw map: a depth band x a field direction."""

    depth: str  # short | intermediate | deep
    direction: str  # left | middle | right
    attempts: int
    completion_rate: float | None
    epa_per_attempt: float | None


class DepthLine(BaseModel):
    """A QB's attempts at one depth band, split into what happened to each."""

    depth: str  # behind_los | short | intermediate | deep
    attempts: int
    completions: int
    misses: int | None  # charted uncatchable incompletions; None before FTN (2022)


class MetricValue(BaseModel):
    name: str
    label: str
    description: str
    unit: str
    value: float | None
    numerator: int
    denominator: int | None


class PlayerProfile(BaseModel):
    player: PlayerSummary
    college: str | None
    height_in: int | None
    weight_lb: int | None
    years_of_experience: int | None
    draft: str | None
    season: int | None
    seasons: list[int]
    columns: list[StatColumn]
    totals: dict[str, float | None]
    weeks: list[WeekLine]
    career: list[SeasonLine]
    metrics: list[MetricValue]
    throw_map: list[ThrowCell]
    depth: list[DepthLine]


class NewsItem(BaseModel):
    title: str
    url: str
    source: str
    published_at: datetime | None


class News(BaseModel):
    items: list[NewsItem]
    fetched_at: datetime | None
    sources_ok: list[str]
    sources_failed: list[str]
