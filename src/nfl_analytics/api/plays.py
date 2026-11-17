"""The plays behind a number: tap a stat anywhere in the dashboard and see them.

Box-score stats use the play rules in stats.py (checked against nflverse's
official totals; where old data disagrees, both numbers are returned).
Advanced stats go through nfl_analytics.metrics, the only place metric SQL is
assembled. Visitor values are always bound parameters.
"""

from __future__ import annotations

from typing import Any, Literal

import duckdb

from nfl_analytics import metrics
from nfl_analytics.api import models as m
from nfl_analytics.api import team_stats
from nfl_analytics.api.explorer import metric_info, stat_info
from nfl_analytics.api.queries import _rows
from nfl_analytics.api.stats import STATS_BY_KEY, Stat

SeasonType = Literal["REG", "POST", "ALL"]
Sort = Literal["time", "value"]
MAX_PAGE = 100

# Play columns every list shows. Plain names only (metrics.metric_plays checks).
PLAY_COLUMNS: tuple[str, ...] = (
    "game_id",
    "play_id",
    "season_type",
    "week",
    "posteam",
    "defteam",
    "home_team",
    "qtr",
    "time",
    "down",
    "ydstogo",
    "yrdln",
    "desc",
    "epa",
    "air_yards",
    "yards_gained",
    "touchdown",
    "interception",
    "sack",
    "fumble_lost",
    "penalty",
)
_SELECT = ", ".join(f'"{c}"' for c in PLAY_COLUMNS)


def _int(v: Any) -> int | None:
    return None if v is None else int(v)


def _float(v: Any) -> float | None:
    return None if v is None else float(v)


def _tags(r: dict[str, Any]) -> list[str]:
    tags = []
    for col, tag in (
        ("touchdown", "TD"),
        ("interception", "INT"),
        ("sack", "Sack"),
        ("fumble_lost", "Fumble"),
        ("penalty", "Penalty"),
    ):
        if r.get(col):
            tags.append(tag)
    return tags


def _row(r: dict[str, Any], *, defense: bool, value: float | None, counted: bool) -> m.PlayRow:
    us = r["defteam"] if defense else r["posteam"]
    them = r["posteam"] if defense else r["defteam"]
    return m.PlayRow(
        game_id=str(r["game_id"]),
        play_id=int(r["play_id"]),
        season_type=str(r["season_type"]),
        week=int(r["week"]),
        team=r["posteam"],
        opponent=them,
        is_home=None if us is None or r["home_team"] is None else us == r["home_team"],
        qtr=_int(r["qtr"]),
        clock=r["time"],
        down=_int(r["down"]),
        distance=_int(r["ydstogo"]),
        field=r["yrdln"],
        description=r["desc"],
        value=value,
        epa=r["epa"],
        air_yards=r["air_yards"],
        yards=r["yards_gained"],
        counted=counted,
        tags=_tags(r),
    )


def _player(cur: duckdb.DuckDBPyConnection, player_id: str) -> m.PlayerRef | None:
    rows = _rows(
        cur,
        "SELECT player_id, display_name AS name, position, team FROM players WHERE player_id = $p",
        {"p": player_id},
    )
    return m.PlayerRef(**rows[0]) if rows else None


def _scope(
    season: int, season_type: SeasonType, team: str | None, defense: bool, alias: str = ""
) -> tuple[str, dict[str, object]]:
    a = f"{alias}." if alias else ""
    where = [f"{a}season = $s"]
    params: dict[str, object] = {"s": season}
    if season_type != "ALL":
        where.append(f"{a}season_type = $st")
        params["st"] = season_type
    if team:
        where.append(f"{a}{'defteam' if defense else 'posteam'} = $t")
        params["t"] = team
    return " AND ".join(where), params


def _stat_plays(
    cur: duckdb.DuckDBPyConnection,
    stat: Stat,
    player: m.PlayerRef,
    *,
    season: int,
    season_type: SeasonType,
    week: int | None,
    team: str | None,
    sort: Sort,
    limit: int,
    offset: int,
) -> m.PlayList:
    defense = stat.side == "defense"
    scope, params = _scope(season, season_type, team, defense)
    params["player"] = player.player_id
    rule = f"({stat.scope}) AND ({stat.plays})"  # trusted constants from stats.py

    weeks = [
        m.PlayWeek(season_type=r[0], week=int(r[1]), plays=int(r[2]), value=float(r[3]))
        for r in cur.execute(
            f"SELECT season_type, week, count(*), sum({stat.play_value}) FROM plays "
            f"WHERE {scope} AND {rule} GROUP BY ALL ORDER BY season_type DESC, week",
            params,
        ).fetchall()
    ]

    page_params = {**params, "n": limit, "o": offset}
    week_sql = ""
    if week is not None:
        week_sql = " AND week = $w"
        page_params["w"] = week
    order = (
        "value DESC NULLS LAST, season_type DESC, week, play_id"
        if sort == "value"
        else "season_type DESC, week, game_id, play_id"
    )
    rows = _rows(
        cur,
        f"SELECT {_SELECT}, ({stat.play_value})::DOUBLE AS value, "
        f"count(*) OVER () AS listed, sum({stat.play_value}) OVER () AS total "
        f"FROM plays WHERE {scope}{week_sql} AND {rule} "
        f"ORDER BY {order} LIMIT $n OFFSET $o",
        page_params,
    )
    listed = int(rows[0]["listed"]) if rows else sum(w.plays for w in weeks if _in(w, week))
    value = (
        float(rows[0]["total"])
        if rows
        else (sum(w.value or 0 for w in weeks if _in(w, week)) if weeks else None)
    )

    # The official box-score figure for the same scope, to show alongside.
    official_scope, official_params = _scope(season, season_type, None, False)
    official_params["player"] = player.player_id
    if team:
        official_scope += " AND team = $t"
        official_params["t"] = team
    if week is not None:
        official_scope += " AND week = $w"
        official_params["w"] = week
    official_row = cur.execute(
        f"SELECT sum({stat.key}) FROM player_weeks WHERE player_id = $player AND {official_scope}",
        official_params,
    ).fetchone()
    official = float(official_row[0]) if official_row and official_row[0] is not None else None

    return m.PlayList(
        stat=stat_info(stat),
        player=player,
        season=season,
        season_type=season_type,
        week=week,
        team=team,
        sort=sort,
        counted_only=False,
        value=value,
        official=official,
        plays=listed,
        counted=listed,
        weeks=weeks,
        offset=offset,
        rows=[_row(r, defense=defense, value=_float(r["value"]), counted=True) for r in rows],
    )


def _in(w: m.PlayWeek, week: int | None) -> bool:
    return week is None or w.week == week


def _metric_plays(
    cur: duckdb.DuckDBPyConnection,
    metric: metrics.MetricDefinition,
    player: m.PlayerRef,
    *,
    season: int,
    season_type: SeasonType,
    week: int | None,
    team: str | None,
    sort: Sort,
    counted_only: bool,
    limit: int,
    offset: int,
) -> m.PlayList:
    info = metric_info(metric)
    weeks = [
        m.PlayWeek(season_type=st, week=w, plays=n, value=v)
        for st, w, n, v in metrics.metric_by_week(
            cur, metric, player.player_id, season, season_type=season_type, team=team
        )
    ]
    rows, listed, counted = metrics.metric_plays(
        cur,
        metric,
        player.player_id,
        season,
        columns=PLAY_COLUMNS,
        season_type=season_type,
        week=week,
        team=team,
        counted_only=counted_only,
        biggest_first=sort == "value",
        limit=limit,
        offset=offset,
    )
    if not rows and offset:
        # Page past the end: still report how many plays there are.
        _, listed, counted = metrics.metric_plays(
            cur,
            metric,
            player.player_id,
            season,
            columns=("play_id",),
            season_type=season_type,
            week=week,
            team=team,
            counted_only=counted_only,
            limit=1,
        )
    value: float | None = None
    if season >= metric.first_season:
        weeks_in = [w for w in weeks if _in(w, week)]
        value = _metric_value(cur, metric, player.player_id, season, season_type, week, team)
        if not weeks_in:
            value = None
    return m.PlayList(
        stat=info,
        player=player,
        season=season,
        season_type=season_type,
        week=week,
        team=team,
        sort=sort,
        counted_only=counted_only,
        value=value,
        official=None,
        plays=listed,
        counted=counted,
        weeks=weeks,
        offset=offset,
        rows=[
            _row(r, defense=False, value=_float(r["value"]), counted=bool(r["counted"]))
            for r in rows
        ],
    )


def _metric_value(
    cur: duckdb.DuckDBPyConnection,
    metric: metrics.MetricDefinition,
    player_id: str,
    season: int,
    season_type: SeasonType,
    week: int | None,
    team: str | None,
) -> float | None:
    """The metric over exactly the filtered plays (a one-player leaderboard)."""
    rows, _ = metrics.metric_leaderboard(
        cur,
        metric,
        season,
        season_type=season_type,
        team=team,
        week=week,
        player_id=player_id,
        limit=1,
    )
    return rows[0].value if rows else None


def play_list(
    cur: duckdb.DuckDBPyConnection,
    *,
    key: str,
    player_id: str,
    season: int,
    season_type: SeasonType = "REG",
    week: int | None = None,
    team: str | None = None,
    sort: Sort = "time",
    counted_only: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> m.PlayList | None:
    """None if the stat or player doesn't exist (the route returns 404)."""
    player = _player(cur, player_id)
    if player is None:
        return None
    limit = max(1, min(limit, MAX_PAGE))
    stat = STATS_BY_KEY.get(key)
    if stat is not None:
        return _stat_plays(
            cur,
            stat,
            player,
            season=season,
            season_type=season_type,
            week=week,
            team=team,
            sort=sort,
            limit=limit,
            offset=offset,
        )
    try:
        metric = metrics.get_definition(cur, key)
    except metrics.MetricError:
        return None
    return _metric_plays(
        cur,
        metric,
        player,
        season=season,
        season_type=season_type,
        week=week,
        team=team,
        sort=sort,
        counted_only=counted_only,
        limit=limit,
        offset=offset,
    )


def team_play_list(
    cur: duckdb.DuckDBPyConnection,
    *,
    key: str,
    team: str,
    season: int,
    season_type: SeasonType = "REG",
    week: int | None = None,
    sort: Sort = "time",
    counted_only: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> m.PlayList | None:
    """The plays behind a team stat. None for unknown stats and for points (scores)."""
    stat = team_stats.TEAM_STATS_BY_KEY.get(key)
    if stat is None or stat.from_scores:
        return None
    limit = max(1, min(limit, MAX_PAGE))
    defense = stat.side == "defense"
    rule = team_stats.play_rule(stat)  # trusted constants; $t is bound
    is_rate = stat.unit == "rate"
    where = ["season = $s"]
    params: dict[str, object] = {"s": season, "t": team}
    if season_type != "ALL":
        where.append("season_type = $st")
        params["st"] = season_type
    scope = " AND ".join(where)

    by_week = cur.execute(
        f"SELECT season_type, week, count(*), sum({stat.value}) FROM plays "
        f"WHERE {scope} AND {rule} GROUP BY ALL ORDER BY season_type DESC, week",
        params,
    ).fetchall()
    weeks = [
        m.PlayWeek(
            season_type=r[0],
            week=int(r[1]),
            plays=int(r[2]),
            value=float(r[3]) / int(r[2]) if stat.combine == "mean" else float(r[3]),
        )
        for r in by_week
    ]
    in_scope = [w for w in weeks if week is None or w.week == week]
    plays_total = sum(w.plays for w in in_scope)
    counted_total = (
        int(
            cur.execute(
                f"SELECT count(*) FROM plays WHERE {scope} AND {rule} AND ({stat.value}) > 0"
                + (" AND week = $w" if week is not None else ""),
                {**params, **({"w": week} if week is not None else {})},
            ).fetchone()[0]  # type: ignore[index]
        )
        if is_rate
        else plays_total
    )
    figure = team_stats.league_values(
        cur, stat, season, season_type=season_type, week=week, team=team
    )

    page_params = {**params, "n": limit, "o": offset}
    extra = ""
    if week is not None:
        extra += " AND week = $w"
        page_params["w"] = week
    if counted_only and is_rate:
        extra += f" AND ({stat.value}) > 0"
    order = (
        "value DESC NULLS LAST, season_type DESC, week, play_id"
        if sort == "value"
        else "season_type DESC, week, game_id, play_id"
    )
    rows = _rows(
        cur,
        f"SELECT {_SELECT}, ({stat.value})::DOUBLE AS value FROM plays "
        f"WHERE {scope}{extra} AND {rule} ORDER BY {order} LIMIT $n OFFSET $o",
        page_params,
    )
    return m.PlayList(
        stat=team_stats.info(stat),
        player=None,
        subject_team=team,
        season=season,
        season_type=season_type,
        week=week,
        team=team,
        sort=sort,
        counted_only=counted_only and is_rate,
        value=figure[0].value if figure else None,
        official=None,
        plays=counted_total if counted_only and is_rate else plays_total,
        counted=counted_total,
        weeks=weeks,
        offset=offset,
        rows=[
            _row(
                r,
                defense=defense,
                value=_float(r["value"]),
                counted=(r["value"] or 0) > 0 if is_rate else True,
            )
            for r in rows
        ],
    )
