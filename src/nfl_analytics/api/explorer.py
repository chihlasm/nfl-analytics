"""Explorer: rank every player on any box-score stat, with filters.

The stat column comes only from the trusted catalog in stats.py; season, team,
position, games and paging are bound parameters. Sorting is chosen from two
fixed expressions, never built from visitor text.
"""

from __future__ import annotations

from typing import Literal

import duckdb

from nfl_analytics.api import models as m
from nfl_analytics.api.queries import _rows
from nfl_analytics.api.stats import STATS, STATS_BY_KEY, Stat

SeasonType = Literal["REG", "POST", "ALL"]
Sort = Literal["total", "per_game"]
Order = Literal["desc", "asc"]

# Position groups people filter by (players.position_group). Linemen and
# specialists have no box-score stats here, so they aren't offered.
POSITION_GROUPS: tuple[str, ...] = ("QB", "RB", "WR", "TE", "DL", "LB", "DB")
MAX_PAGE = 100

# Fixed ranking expressions; ties share a rank, then list alphabetically.
_RANK_SQL: dict[tuple[Sort, Order], str] = {
    ("total", "desc"): "value DESC, per_game DESC",
    ("total", "asc"): "value ASC, per_game ASC",
    ("per_game", "desc"): "per_game DESC, value DESC",
    ("per_game", "asc"): "per_game ASC, value ASC",
}


def stat_info(stat: Stat) -> m.StatInfo:
    return m.StatInfo(
        key=stat.key, label=stat.label, short=stat.short, group=stat.group, decimals=stat.decimals
    )


def catalog() -> m.StatCatalog:
    return m.StatCatalog(stats=[stat_info(s) for s in STATS], position_groups=list(POSITION_GROUPS))


def seasons(cur: duckdb.DuckDBPyConnection) -> list[int]:
    rows = cur.execute("SELECT DISTINCT season FROM player_weeks ORDER BY season DESC").fetchall()
    return [r[0] for r in rows]


def explore(
    cur: duckdb.DuckDBPyConnection,
    *,
    stat_key: str,
    season: int,
    season_type: SeasonType = "REG",
    position_group: str | None = None,
    team: str | None = None,
    min_games: int = 0,
    sort: Sort = "total",
    order: Order = "desc",
    limit: int = 50,
    offset: int = 0,
) -> m.Explorer | None:
    """None if the stat isn't in the catalog (the route turns that into a 404)."""
    stat = STATS_BY_KEY.get(stat_key)
    if stat is None:
        return None
    if position_group not in POSITION_GROUPS:
        position_group = None
    limit = max(1, min(limit, MAX_PAGE))
    offset = max(0, offset)

    col = stat.key  # trusted constant from stats.py
    params: dict[str, object] = {
        "s": season,
        "st": season_type,
        "pg": position_group,
        "t": team,
        "g": min_games,
        "n": limit,
        "o": offset,
    }
    rows = _rows(
        cur,
        f"""
        WITH per_player AS (
            SELECT
                w.player_id,
                any_value(w.player_display_name)        AS name,
                arg_max(w.position, w.week)              AS position,
                any_value(p.position_group)              AS position_group,
                -- latest team: playoff weeks count after the regular season
                arg_max(w.team, w.week + CASE WHEN w.season_type = 'POST' THEN 100 ELSE 0 END)
                                                         AS team,
                count(*)                                 AS games,
                sum(w.{col})                             AS value
            FROM player_weeks AS w
            LEFT JOIN players AS p USING (player_id)
            WHERE w.season = $s
              AND ($st = 'ALL' OR w.season_type = $st)
              AND ($t IS NULL OR w.team = $t)
              AND ($pg IS NULL OR p.position_group = $pg)
            GROUP BY w.player_id
            HAVING sum(w.{col}) IS NOT NULL AND sum(w.{col}) <> 0 AND count(*) >= $g
        ),
        ranked AS (
            SELECT *, value / games AS per_game, count(*) OVER () AS total
            FROM per_player
        )
        SELECT *, rank() OVER (ORDER BY {_RANK_SQL[(sort, order)]}) AS rank
        FROM ranked
        ORDER BY {_RANK_SQL[(sort, order)]}, name
        LIMIT $n OFFSET $o
        """,
        params,
    )
    total = rows[0]["total"] if rows else _count(cur, col, params)
    through = cur.execute(
        "SELECT max(week) FROM player_weeks WHERE season = $s AND season_type = 'REG'",
        {"s": season},
    ).fetchone()
    return m.Explorer(
        season=season,
        seasons=seasons(cur),
        season_type=season_type,
        stat=stat_info(stat),
        sort=sort,
        order=order,
        position_group=position_group,
        team=team,
        min_games=min_games,
        through_week=through[0] if through else None,
        total=int(total),
        offset=offset,
        rows=[m.ExplorerRow(**{k: r[k] for k in m.ExplorerRow.model_fields}) for r in rows],
    )


def _count(cur: duckdb.DuckDBPyConnection, col: str, params: dict[str, object]) -> int:
    """Total matches when the requested page is past the end."""
    row = cur.execute(
        f"""
        SELECT count(*) FROM (
            SELECT w.player_id
            FROM player_weeks AS w LEFT JOIN players AS p USING (player_id)
            WHERE w.season = $s AND ($st = 'ALL' OR w.season_type = $st)
              AND ($t IS NULL OR w.team = $t)
              AND ($pg IS NULL OR p.position_group = $pg)
            GROUP BY w.player_id
            HAVING sum(w.{col}) IS NOT NULL AND sum(w.{col}) <> 0 AND count(*) >= $g
        )
        """,
        {k: v for k, v in params.items() if k not in ("n", "o")},
    ).fetchone()
    return int(row[0]) if row else 0
