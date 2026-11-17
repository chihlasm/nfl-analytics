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
    unit: str  # count | rate (0-1) | epa | yards | points (api/team_stats.py)
    has_plays: bool = True  # points come from scores, so they have no plays list


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


class StatInfo(BaseModel):
    key: str
    label: str
    short: str
    group: str  # passing | rushing | receiving | defense | advanced
    decimals: int
    kind: str = "stat"  # stat (box score) | metric (sql/metrics.sql)
    unit: str = "count"  # count | rate (0-1, shown as %) | epa | yards
    description: str | None = None
    first_season: int | None = None
    per_game: bool = True  # whether "per game" means anything (not for rates)
    credit: str | None = None  # data credit to show with it (FTN)
    higher_is_better: bool = True  # sets "best first" for rankings
    has_plays: bool = True  # whether tapping it can list plays (not points)


class StatCatalog(BaseModel):
    stats: list[StatInfo]
    position_groups: list[str]
    team_stats: list[StatInfo] = []


class ExplorerRow(BaseModel):
    rank: int
    player_id: str
    name: str
    position: str | None
    position_group: str | None
    team: str | None  # with a team filter: that team; otherwise their latest team
    games: int
    value: float  # season total (or the rate/average for metrics)
    per_game: float
    attempts: int | None = None  # plays behind a rate or average


class Explorer(BaseModel):
    season: int
    seasons: list[int]
    season_type: str  # REG | POST | ALL
    stat: StatInfo
    sort: str  # total | per_game
    order: str  # desc | asc
    position_group: str | None
    team: str | None
    min_games: int
    through_week: int | None
    total: int  # players matching the filters, before paging
    offset: int
    rows: list[ExplorerRow]
    min_plays: int = 0  # qualifier for rates and averages
    note: str | None = None  # why there are no rows (data starts later), if so


class PlayerRef(BaseModel):
    player_id: str
    name: str
    position: str | None
    team: str | None


class PlayRow(BaseModel):
    game_id: str
    play_id: int
    season_type: str
    week: int
    team: str | None  # the offense
    opponent: str | None  # the other team, from the player's side
    is_home: bool | None
    qtr: int | None
    clock: str | None
    down: int | None
    distance: int | None
    field: str | None  # "ATL 35"
    description: str | None
    value: float | None  # what this play adds to the stat
    epa: float | None
    air_yards: float | None
    yards: float | None
    counted: bool  # for rates: is this play one of the counted ones (a miss)
    tags: list[str]  # TD, INT, Sack, Fumble, Penalty


class PlayWeek(BaseModel):
    season_type: str
    week: int
    plays: int
    value: float | None


class PlayList(BaseModel):
    stat: StatInfo
    player: PlayerRef | None  # None for a team stat
    subject_team: str | None = None  # the team, for a team stat
    season: int
    season_type: str
    week: int | None
    team: str | None
    sort: str  # time | value
    counted_only: bool
    value: float | None  # the stat over the filtered plays
    official: float | None  # nflverse box-score total for the same scope (stats only)
    plays: int  # plays listed in total (before paging)
    counted: int  # plays that count (equals plays except for rates)
    weeks: list[PlayWeek]  # the whole scope by week, for the week picker and chart
    offset: int
    rows: list[PlayRow]


class TeamExplorerRow(BaseModel):
    rank: int
    team: str
    name: str
    conference: str | None
    division: str | None
    games: int
    value: float
    plays: int | None  # plays behind it (None for points, which come from scores)


class TeamExplorer(BaseModel):
    season: int
    seasons: list[int]
    season_type: str
    stat: StatInfo
    order: str  # best | worst
    conference: str | None
    through_week: int | None
    league_avg: float | None
    rows: list[TeamExplorerRow]
