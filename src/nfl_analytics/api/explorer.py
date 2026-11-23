"""Explorer: rank every player on any box-score stat, with filters.

The stat column comes only from the trusted catalog in stats.py; season, team,
position, games and paging are bound parameters. Sorting is chosen from two
fixed expressions, never built from visitor text.
"""

from __future__ import annotations

from typing import Literal

import duckdb

from nfl_analytics import metrics
from nfl_analytics.api import models as m
from nfl_analytics.api import team_stats
from nfl_analytics.api.queries import _rows
from nfl_analytics.api.stats import STATS, STATS_BY_KEY, Stat

SeasonType = Literal["REG", "POST", "ALL"]
Sort = Literal["total", "per_game"]
Order = Literal["desc", "asc"]

# Position groups people filter by (players.position_group). Linemen and
# specialists have no box-score stats here, so they aren't offered.
POSITION_GROUPS: tuple[str, ...] = ("QB", "RB", "WR", "TE", "DL", "LB", "DB")
MAX_PAGE = 100
# Rates and averages rank only players with enough plays behind them, unless the
# visitor picks another minimum. Roughly a starter's first three games.
DEFAULT_MIN_PLAYS = 50
_METRIC_DECIMALS = {"count": 0, "rate": 1, "epa": 3}

# Fixed ranking expressions; ties share a rank, then list alphabetically.
_RANK_SQL: dict[tuple[Sort, Order], str] = {
    ("total", "desc"): "value DESC, per_game DESC",
    ("total", "asc"): "value ASC, per_game ASC",
    ("per_game", "desc"): "per_game DESC, value DESC",
    ("per_game", "asc"): "per_game ASC, value ASC",
}


def stat_info(stat: Stat) -> m.StatInfo:
    return m.StatInfo(
        key=stat.key,
        label=stat.label,
        short=stat.short,
        group=stat.group,
        decimals=stat.decimals,
        unit="epa" if stat.key.endswith("_epa") else "count",
    )


def metric_info(metric: metrics.MetricDefinition) -> m.StatInfo:
    return m.StatInfo(
        key=metric.name,
        label=metric.label,
        short=metric.label,
        group="advanced",
        decimals=_METRIC_DECIMALS.get(metric.unit, 1),
        kind="metric",
        unit=metric.unit,
        description=metric.description,
        first_season=metric.first_season,
        per_game=metric.unit == "count",
        credit=metrics.FTN_CREDIT if metrics.uses_ftn(metric) else None,
    )


def catalog(cur: duckdb.DuckDBPyConnection) -> m.StatCatalog:
    return m.StatCatalog(
        stats=[stat_info(s) for s in STATS]
        + [metric_info(d) for d in metrics.list_definitions(cur)],
        position_groups=list(POSITION_GROUPS),
        team_stats=[team_stats.info(t) for t in team_stats.TEAM_STATS],
    )


def explore_teams(
    cur: duckdb.DuckDBPyConnection,
    *,
    stat_key: str,
    season: int,
    season_type: SeasonType = "REG",
    conference: str | None = None,
    best_first: bool = True,
) -> m.TeamExplorer | None:
    """Every team ranked on one team stat. None if the stat isn't in the catalog."""
    stat = team_stats.TEAM_STATS_BY_KEY.get(stat_key)
    if stat is None:
        return None
    values = team_stats.league_values(cur, stat, season, season_type=season_type)
    avg = sum(v.value for v in values) / len(values) if values else None
    names = {
        r[0]: r[1:]
        for r in cur.execute("SELECT team, name, conference, division FROM teams").fetchall()
    }
    aligned = season >= 2002  # divisions and conferences as they are now
    rows: list[m.TeamExplorerRow] = []
    # Ranks are always league ranks (1st = best), even when listing worst first, and
    # are taken before the conference filter, so "3rd" means 3rd in the NFL.
    ordered = team_stats.ranked(values, stat)
    if not best_first:
        ordered = ordered[::-1]
    for rank, v in ordered:
        name, conf, div = names.get(v.team, (v.team, None, None))
        if conference and (not aligned or conf != conference):
            continue
        rows.append(
            m.TeamExplorerRow(
                rank=rank,
                team=v.team,
                name=name or v.team,
                conference=conf if aligned else None,
                division=div if aligned else None,
                games=v.games,
                value=v.value,
                plays=v.plays,
            )
        )
    through = cur.execute(
        "SELECT max(week) FROM plays WHERE season = $s AND season_type = 'REG'", {"s": season}
    ).fetchone()
    return m.TeamExplorer(
        season=season,
        seasons=seasons(cur),
        season_type=season_type,
        stat=team_stats.info(stat),
        order="best" if best_first else "worst",
        conference=conference if aligned else None,
        through_week=through[0] if through else None,
        league_avg=avg,
        rows=rows,
    )


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
    min_plays: int | None = None,
) -> m.Explorer | None:
    """None if the stat isn't in the catalog (the route turns that into a 404)."""
    if position_group not in POSITION_GROUPS:
        position_group = None
    limit = max(1, min(limit, MAX_PAGE))
    offset = max(0, offset)
    stat = STATS_BY_KEY.get(stat_key)
    if stat is None:
        try:
            metric = metrics.get_definition(cur, stat_key)
        except metrics.MetricError:
            return None
        return _explore_metric(
            cur,
            metric,
            season=season,
            season_type=season_type,
            position_group=position_group,
            team=team,
            min_games=min_games,
            min_plays=min_plays,
            sort=sort,
            order=order,
            limit=limit,
            offset=offset,
        )

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
        rows=[
            m.ExplorerRow(**{k: r[k] for k in m.ExplorerRow.model_fields if k in r}) for r in rows
        ],
    )


def _explore_metric(
    cur: duckdb.DuckDBPyConnection,
    metric: metrics.MetricDefinition,
    *,
    season: int,
    season_type: SeasonType,
    position_group: str | None,
    team: str | None,
    min_games: int,
    min_plays: int | None,
    sort: Sort,
    order: Order,
    limit: int,
    offset: int,
) -> m.Explorer:
    info = metric_info(metric)
    if not info.per_game:
        sort = "total"
    needs_qualifier = metric.unit != "count"
    qualifier = (DEFAULT_MIN_PLAYS if min_plays is None else min_plays) if needs_qualifier else 0
    rows, total = metrics.metric_leaderboard(
        cur,
        metric,
        season,
        season_type=season_type,
        team=team,
        position_group=position_group,
        min_games=min_games,
        min_plays=qualifier,
        per_game=sort == "per_game",
        ascending=order == "asc",
        limit=limit,
        offset=offset,
    )
    through = cur.execute(
        "SELECT max(week) FROM player_weeks WHERE season = $s AND season_type = 'REG'",
        {"s": season},
    ).fetchone()
    note = None
    if season < metric.first_season:
        note = f"{metric.label} uses charting data that starts in {metric.first_season}."
    return m.Explorer(
        season=season,
        seasons=seasons(cur),
        season_type=season_type,
        stat=info,
        sort=sort,
        order=order,
        position_group=position_group,
        team=team,
        min_games=min_games,
        through_week=through[0] if through else None,
        total=total,
        offset=offset,
        rows=[
            m.ExplorerRow(
                rank=r.rank,
                player_id=r.player_id,
                name=r.name,
                position=r.position,
                position_group=r.position_group,
                team=r.team,
                games=r.games,
                value=r.value,
                per_game=r.per_game,
                attempts=r.attempts,
            )
            for r in rows
        ],
        min_plays=qualifier,
        note=note,
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
