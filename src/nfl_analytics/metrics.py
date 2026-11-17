"""Compute saved metrics (defined in sql/metrics.sql) for a player.

This is the one place metric SQL is assembled. The CLI uses it today; the API
and the MCP server will use the same functions, so every surface counts alike.
Filters come from the trusted `metric_definitions` table; every user-supplied
value is passed as a bound parameter, never formatted into SQL.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import duckdb

SeasonType = Literal["REG", "POST", "ALL"]


class MetricError(ValueError):
    """Bad metric name, unknown player, or an ambiguous player name."""


@dataclass(frozen=True, slots=True)
class MetricDefinition:
    name: str
    label: str
    description: str
    source_view: str
    player_column: str
    row_filter: str
    aggregate: str
    denominator_filter: str | None
    first_season: int
    unit: str


@dataclass(frozen=True, slots=True)
class PlayerMatch:
    player_id: str
    display_name: str
    position: str | None
    team: str | None


@dataclass(frozen=True, slots=True)
class MetricResult:
    metric: MetricDefinition
    player: PlayerMatch
    season: int
    season_type: SeasonType
    week_from: int | None
    week_to: int | None
    value: float | None
    numerator_rows: int
    denominator_rows: int | None


def connect_readonly(db_path: Path) -> duckdb.DuckDBPyConnection:
    """Open the live database read-only. Readers never take a write lock."""
    if not db_path.exists():
        raise FileNotFoundError(f"No database at {db_path}. Run `nfl refresh` first.")
    return duckdb.connect(str(db_path), read_only=True)


def get_definition(con: duckdb.DuckDBPyConnection, name: str) -> MetricDefinition:
    row = con.execute(
        "SELECT name, label, description, source_view, player_column, row_filter, aggregate, "
        "denominator_filter, first_season, unit FROM metric_definitions WHERE name = ?",
        [name],
    ).fetchone()
    if row is None:
        known = [
            r[0] for r in con.execute("SELECT name FROM metric_definitions ORDER BY 1").fetchall()
        ]
        raise MetricError(f"Unknown metric {name!r}. Known metrics: {', '.join(known)}")
    return MetricDefinition(*row)


def find_players(
    con: duckdb.DuckDBPyConnection, query: str, *, limit: int = 10
) -> list[PlayerMatch]:
    """Players whose name contains `query` (case-insensitive), most recent first."""
    rows = con.execute(
        "SELECT player_id, display_name, position, team FROM players "
        "WHERE display_name ILIKE '%' || ? || '%' OR player_id = ? "
        "ORDER BY last_season DESC NULLS LAST, display_name LIMIT ?",
        [query, query, limit],
    ).fetchall()
    return [PlayerMatch(*r) for r in rows]


def resolve_player(con: duckdb.DuckDBPyConnection, query: str) -> PlayerMatch:
    matches = find_players(con, query)
    if not matches:
        raise MetricError(f"No player matches {query!r}")
    exact = [m for m in matches if m.display_name.lower() == query.lower() or m.player_id == query]
    if len(exact) == 1:
        return exact[0]
    if len(matches) == 1:
        return matches[0]
    options = "; ".join(
        f"{m.display_name} ({m.position}, {m.team}, {m.player_id})" for m in matches
    )
    raise MetricError(f"{query!r} matches several players: {options}. Use the full name or ID.")


def compute_metric(
    con: duckdb.DuckDBPyConnection,
    metric_name: str,
    player_query: str,
    season: int,
    *,
    season_type: SeasonType = "REG",
    week_from: int | None = None,
    week_to: int | None = None,
) -> MetricResult:
    metric = get_definition(con, metric_name)
    if season < metric.first_season:
        raise MetricError(
            f"{metric.label} needs data that starts in {metric.first_season}; "
            f"{season} is not available."
        )
    player = resolve_player(con, player_query)

    where = [f"{metric.player_column} = $player", "season = $season"]
    params: dict[str, object] = {"player": player.player_id, "season": season}
    if season_type != "ALL":
        where.append("season_type = $season_type")
        params["season_type"] = season_type
    if week_from is not None:
        where.append("week >= $week_from")
        params["week_from"] = week_from
    if week_to is not None:
        where.append("week <= $week_to")
        params["week_to"] = week_to
    scope = " AND ".join(where)

    row = con.execute(
        f"SELECT {metric.aggregate}, count(*) FROM {metric.source_view} "
        f"WHERE {scope} AND ({metric.row_filter})",
        params,
    ).fetchone()
    value = float(row[0]) if row and row[0] is not None else None
    numerator_rows = int(row[1]) if row else 0

    denominator_rows: int | None = None
    if metric.denominator_filter:
        drow = con.execute(
            f"SELECT count(*) FROM {metric.source_view} "
            f"WHERE {scope} AND ({metric.denominator_filter})",
            params,
        ).fetchone()
        denominator_rows = int(drow[0]) if drow else 0
        value = (value / denominator_rows) if (value is not None and denominator_rows) else None

    return MetricResult(
        metric=metric,
        player=player,
        season=season,
        season_type=season_type,
        week_from=week_from,
        week_to=week_to,
        value=value,
        numerator_rows=numerator_rows,
        denominator_rows=denominator_rows,
    )


# ---------------------------------------------------------------------------
# League-wide rankings and the plays behind a metric (the dashboard and the
# future MCP server both call these, so a metric counts the same everywhere).
# ---------------------------------------------------------------------------

# Columns that come from FTN charting (CC-BY-SA 4.0): any metric that reads one
# must credit "FTN Data via nflverse" wherever it is shown.
FTN_FIELDS: frozenset[str] = frozenset(
    {
        "is_charted",
        "is_catchable_ball",
        "is_throw_away",
        "is_drop",
        "is_contested_ball",
        "is_interception_worthy",
        "is_inaccurate_incompletion",
        "is_short_throw_miss",
        "n_blitzers",
        "n_pass_rushers",
        "is_blitz",
    }
)
FTN_CREDIT = "FTN Data via nflverse"

_AVG = re.compile(r"^\s*avg\(\s*([a-z_][a-z0-9_]*)\s*\)\s*$")
_COUNT = re.compile(r"^\s*count\(\s*\*\s*\)\s*$")
_WORD = re.compile(r"[a-z_][a-z0-9_]*")


def list_definitions(con: duckdb.DuckDBPyConnection) -> list[MetricDefinition]:
    rows = con.execute(
        "SELECT name, label, description, source_view, player_column, row_filter, aggregate, "
        "denominator_filter, first_season, unit FROM metric_definitions ORDER BY name"
    ).fetchall()
    return [MetricDefinition(*r) for r in rows]


def uses_ftn(metric: MetricDefinition) -> bool:
    text = f"{metric.row_filter} {metric.denominator_filter or ''} {metric.aggregate}"
    return bool(FTN_FIELDS & set(_WORD.findall(text.lower())))


def is_rate(metric: MetricDefinition) -> bool:
    return metric.denominator_filter is not None


def play_value_column(metric: MetricDefinition) -> str | None:
    """For an average metric, the per-play column it averages (None for counts)."""
    m = _AVG.match(metric.aggregate)
    if m:
        return m.group(1)
    if _COUNT.match(metric.aggregate):
        return None
    raise MetricError(f"{metric.name}: unsupported aggregate {metric.aggregate!r}")


def _scope(
    params: dict[str, object],
    *,
    season: int,
    season_type: SeasonType,
    week: int | None = None,
    team: str | None = None,
) -> str:
    where = ["v.season = $season"]
    params["season"] = season
    if season_type != "ALL":
        where.append("v.season_type = $season_type")
        params["season_type"] = season_type
    if week is not None:
        where.append("v.week = $week")
        params["week"] = week
    if team is not None:
        where.append("v.posteam = $team")
        params["team"] = team
    return " AND ".join(where)


@dataclass(frozen=True, slots=True)
class LeaderboardRow:
    rank: int
    player_id: str
    name: str
    position: str | None
    position_group: str | None
    team: str | None
    games: int
    value: float
    per_game: float
    attempts: int | None


def metric_leaderboard(
    con: duckdb.DuckDBPyConnection,
    metric: MetricDefinition,
    season: int,
    *,
    season_type: SeasonType = "REG",
    team: str | None = None,
    position_group: str | None = None,
    min_games: int = 0,
    min_plays: int = 0,
    per_game: bool = False,
    ascending: bool = False,
    week: int | None = None,
    player_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[LeaderboardRow], int]:
    """Every player ranked on one metric. Returns (page of rows, total matching).

    Rates and averages count only players with at least `min_plays` qualifying
    plays (the denominator for rates, the averaged plays for averages).
    """
    if season < metric.first_season:
        return [], 0
    params: dict[str, object] = {"pg": position_group, "g": min_games, "n": limit, "o": offset}
    scope = _scope(params, season=season, season_type=season_type, week=week, team=team)
    pc = metric.player_column
    if player_id is not None:
        scope += f" AND v.{pc} = $player"
        params["player"] = player_id
    avg_col = play_value_column(metric)
    if is_rate(metric):
        value = "num / nullif(den, 0)"
        attempts = "den"
    elif avg_col:
        value = "num"
        attempts = "num_rows"
    else:
        value = "num"
        attempts = "NULL"
    if attempts == "NULL":
        qualifies = "num_rows > 0"
    else:
        qualifies = f"{attempts} >= greatest($mp, 1)"
        params["mp"] = min_plays
    metric_sort = "per_game" if per_game else "value"
    direction = "ASC" if ascending else "DESC"
    rank_by = f"{metric_sort} {direction}, games DESC"

    sql = f"""
        WITH agg AS (
            SELECT
                v.{pc}                                                   AS player_id,
                count(DISTINCT v.game_id)                                AS games,
                {metric.aggregate} FILTER (WHERE {metric.row_filter})    AS num,
                count(*) FILTER (WHERE {metric.row_filter})              AS num_rows,
                count(*) FILTER (WHERE {metric.denominator_filter or "FALSE"}) AS den,
                arg_max(v.posteam, v.week + CASE WHEN v.season_type = 'POST' THEN 100 ELSE 0 END)
                                                                         AS team
            FROM {metric.source_view} AS v
            WHERE {scope} AND v.{pc} IS NOT NULL
            GROUP BY v.{pc}
        ),
        shaped AS (
            SELECT
                a.player_id, a.games, a.team,
                coalesce(p.display_name, a.player_id)   AS name,
                p.position, p.position_group,
                ({value})::DOUBLE                       AS value,
                ({value})::DOUBLE / a.games             AS per_game,
                {attempts}                              AS attempts
            FROM agg AS a
            LEFT JOIN players AS p USING (player_id)
            WHERE {qualifies} AND a.games >= $g AND ($pg IS NULL OR p.position_group = $pg)
        ),
        ranked AS (
            SELECT *, count(*) OVER () AS total, rank() OVER (ORDER BY {rank_by}) AS rank
            FROM shaped WHERE value IS NOT NULL
        )
        SELECT rank, player_id, name, position, position_group, team, games, value,
               per_game, attempts, total
        FROM ranked ORDER BY {rank_by}, name LIMIT $n OFFSET $o
    """
    rows = con.execute(sql, params).fetchall()
    total = int(rows[0][-1]) if rows else _leaderboard_total(con, sql, params)
    return [LeaderboardRow(*r[:-1]) for r in rows], total


def _leaderboard_total(con: duckdb.DuckDBPyConnection, sql: str, params: dict[str, object]) -> int:
    """Total when the requested page is past the end: same query, first row only."""
    first = con.execute(sql, {**params, "n": 1, "o": 0}).fetchone()
    return int(first[-1]) if first else 0


def metric_plays(
    con: duckdb.DuckDBPyConnection,
    metric: MetricDefinition,
    player_id: str,
    season: int,
    *,
    columns: tuple[str, ...],
    season_type: SeasonType = "REG",
    week: int | None = None,
    team: str | None = None,
    counted_only: bool = False,
    biggest_first: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict[str, object]], int, int]:
    """The plays behind one player's metric: (page of rows, plays listed, plays counted).

    Rates list every play in the denominator with `counted` marking the numerator
    (the misses among all short throws); counts list only counted plays; averages
    list the averaged plays with `value` set to each play's figure.
    `columns` must be plain column names chosen by the caller's code.
    """
    for c in columns:
        if not _WORD.fullmatch(c):
            raise MetricError(f"Bad column name {c!r}")
    params: dict[str, object] = {"player": player_id, "n": limit, "o": offset}
    scope = _scope(params, season=season, season_type=season_type, week=week, team=team)
    avg_col = play_value_column(metric)
    pool = metric.denominator_filter if is_rate(metric) else metric.row_filter
    keep = metric.row_filter if counted_only else pool
    value = f"v.{avg_col}" if avg_col else f"CASE WHEN ({metric.row_filter}) THEN 1 ELSE 0 END"
    order = (
        "value DESC NULLS LAST, v.week, v.play_id"
        if biggest_first
        else "v.season_type DESC, v.week, v.game_id, v.play_id"
    )
    select = ", ".join(f"v.{c}" for c in columns)
    rows = con.execute(
        f"""
        SELECT {select},
               coalesce(({metric.row_filter}), FALSE)    AS counted,
               ({value})::DOUBLE                         AS value,
               count(*) OVER ()                          AS listed,
               count(*) FILTER (WHERE {metric.row_filter}) OVER () AS counted_total
        FROM {metric.source_view} AS v
        WHERE v.{metric.player_column} = $player AND {scope} AND ({keep})
        ORDER BY {order}
        LIMIT $n OFFSET $o
        """,
        params,
    ).fetchall()
    names = [*columns, "counted", "value", "listed", "counted_total"]
    out = [dict(zip(names, r, strict=True)) for r in rows]
    if out:
        return out, int(str(out[0]["listed"])), int(str(out[0]["counted_total"]))
    return [], 0, 0


def metric_by_week(
    con: duckdb.DuckDBPyConnection,
    metric: MetricDefinition,
    player_id: str,
    season: int,
    *,
    season_type: SeasonType = "REG",
    team: str | None = None,
) -> list[tuple[str, int, int, float | None]]:
    """Per game week: (season_type, week, plays listed, metric value that week)."""
    params: dict[str, object] = {"player": player_id}
    scope = _scope(params, season=season, season_type=season_type, team=team)
    pool = metric.denominator_filter if is_rate(metric) else metric.row_filter
    value = (
        f"({metric.aggregate} FILTER (WHERE {metric.row_filter}))::DOUBLE"
        f" / nullif(count(*) FILTER (WHERE {metric.denominator_filter}), 0)"
        if is_rate(metric)
        else f"({metric.aggregate} FILTER (WHERE {metric.row_filter}))::DOUBLE"
    )
    rows = con.execute(
        f"""
        SELECT v.season_type, v.week, count(*) FILTER (WHERE {pool}) AS listed, {value} AS value
        FROM {metric.source_view} AS v
        WHERE v.{metric.player_column} = $player AND {scope}
        GROUP BY v.season_type, v.week
        HAVING count(*) FILTER (WHERE {pool}) > 0
        ORDER BY v.season_type DESC, v.week
        """,
        params,
    ).fetchall()
    return [(str(r[0]), int(r[1]), int(r[2]), None if r[3] is None else float(r[3])) for r in rows]
