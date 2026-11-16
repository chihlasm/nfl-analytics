"""Compute saved metrics (defined in sql/metrics.sql) for a player.

This is the one place metric SQL is assembled. The CLI uses it today; the API
and the MCP server will use the same functions, so every surface counts alike.
Filters come from the trusted `metric_definitions` table; every user-supplied
value is passed as a bound parameter, never formatted into SQL.
"""

from __future__ import annotations

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
