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


class TeamInfo(BaseModel):
    team: str
    name: str
    nickname: str | None
    conference: str | None
    division: str | None


class TeamRecord(BaseModel):
    wins: int
    losses: int
    ties: int
    points_for: int
    points_against: int
    home: str  # "W-L" or "W-L-T"
    away: str
    division: str
    streak: str | None  # "W3", "L1"


class StandingRow(BaseModel):
    """One team in a table. Sorted by win percentage, then point difference
    (a simple order, not the NFL's official tiebreakers)."""

    info: TeamInfo
    record: TeamRecord


class Standings(BaseModel):
    season: int
    seasons: list[int]
    # Division alignment from 2002 on; earlier seasons show conference tables only
    # when the conferences match, so we flag whether divisions apply.
    divisions_apply: bool
    teams: list[StandingRow]


class TeamGame(BaseModel):
    game_id: str
    week: int
    game_type: str
    game_date: date | None
    kickoff_time_et: str | None
    opponent: str
    is_home: bool
    points_for: int | None
    points_against: int | None
    result: str | None  # W | L | T, None if not played yet
    is_overtime: bool
    is_division_game: bool
    team_line: float | None  # negative = favoured
    total_line: float | None
    qb_name: str | None
    opponent_qb_name: str | None


class TeamRank(BaseModel):
    """A team stat with its league rank (1 = best)."""

    key: str
    label: str
    side: str  # offense | defense
    value: float | None
    rank: int | None
    teams: int
    league_avg: float | None
    decimals: int
    unit: str  # "" | "%" | "yds" | "pts"


class TeamProfile(BaseModel):
    info: TeamInfo
    season: int
    seasons: list[int]
    record: TeamRecord
    division_rank: int | None
    division: list[StandingRow]
    games: list[TeamGame]
    ranks: list[TeamRank]
    leaders: list[LeaderBoard]
    injury_week: int | None
    injuries: list[InjuryRow]
