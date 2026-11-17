"""Queries behind each API endpoint. Views only; every visitor value is bound."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import duckdb

from nfl_analytics.api import models as m
from nfl_analytics.api.stats import (
    groups_for,
    stats_for,
)
from nfl_analytics.metrics import MetricError, compute_metric

# Saved metrics shown on player pages, by position group.
PLAYER_METRICS: dict[str, tuple[str, ...]] = {
    "QB": (
        "short_throw_misses",
        "short_throw_miss_rate",
        "catchable_ball_rate",
        "epa_per_dropback",
    ),
    "WR": ("receiver_drops",),
    "TE": ("receiver_drops",),
    "RB": ("receiver_drops",),
}

INJURY_ORDER = ("Out", "Doubtful", "Questionable")
SKILL_POSITIONS = ("QB", "RB", "WR", "TE")


def _rows(cur: duckdb.DuckDBPyConnection, sql: str, params: Any = None) -> list[dict[str, Any]]:
    result = cur.execute(sql, params or {})
    cols = [d[0] for d in result.description]
    return [dict(zip(cols, r, strict=True)) for r in result.fetchall()]


def _one(cur: duckdb.DuckDBPyConnection, sql: str, params: Any = None) -> dict[str, Any] | None:
    rows = _rows(cur, sql, params)
    return rows[0] if rows else None


def current_week(cur: duckdb.DuckDBPyConnection, season: int) -> int | None:
    """The first week with an unfinished game, or the last week if the season is over."""
    row = cur.execute(
        "SELECT coalesce("
        "  (SELECT min(week) FROM games WHERE season = $s AND NOT is_final),"
        "  (SELECT max(week) FROM games WHERE season = $s))",
        {"s": season},
    ).fetchone()
    return int(row[0]) if row and row[0] is not None else None


def meta(cur: duckdb.DuckDBPyConnection) -> m.Meta:
    # epoch() reads both TIMESTAMP (UTC) and TIMESTAMPTZ without needing pytz.
    info = _one(
        cur,
        "SELECT epoch(built_at) AS built_epoch, latest_season, latest_week, current_season "
        "FROM build_info",
    )
    if info is None:
        raise RuntimeError("build_info is missing")
    season = info["latest_season"] or info["current_season"]
    return m.Meta(
        built_at=datetime.fromtimestamp(info["built_epoch"], UTC),
        latest_season=info["latest_season"],
        latest_week=info["latest_week"],
        current_season=season,
        current_week=current_week(cur, season),
    )


def week_games(cur: duckdb.DuckDBPyConnection, season: int, week: int | None) -> m.Week:
    weeks = [
        r[0]
        for r in cur.execute(
            "SELECT DISTINCT week FROM games WHERE season = $s ORDER BY week", {"s": season}
        ).fetchall()
    ]
    if not weeks:
        return m.Week(season=season, week=week or 0, weeks=[], games=[])
    if week is None or week not in weeks:
        week = current_week(cur, season) or weeks[-1]
    rows = _rows(
        cur,
        "SELECT * FROM games WHERE season = $s AND week = $w "
        "ORDER BY game_date, kickoff_time_et, game_id",
        {"s": season, "w": week},
    )
    games = [
        m.Game(
            game_id=r["game_id"],
            season=r["season"],
            week=r["week"],
            game_type=r["game_type"],
            game_date=r["game_date"],
            kickoff_time_et=r["kickoff_time_et"],
            home=m.TeamScore(team=r["home_team"], score=r["home_score"], qb_name=r["home_qb_name"]),
            away=m.TeamScore(team=r["away_team"], score=r["away_score"], qb_name=r["away_qb_name"]),
            is_final=bool(r["is_final"]),
            is_overtime=bool(r["is_overtime"]),
            spread_line=r["spread_line"],
            total_line=r["total_line"],
            stadium=r["stadium"],
            roof=r["roof"],
        )
        for r in rows
    ]
    return m.Week(season=season, week=week, weeks=weeks, games=games)


def injuries(cur: duckdb.DuckDBPyConnection, season: int) -> m.Injuries:
    week_row = cur.execute(
        "SELECT max(week) FROM injury_reports WHERE season = $s", {"s": season}
    ).fetchone()
    week = week_row[0] if week_row else None
    if week is None:
        return m.Injuries(season=season, week=None, counts={}, rows=[])
    rows = _rows(
        cur,
        "SELECT player_id, player_name, team, position, report_status AS status, "
        "coalesce(primary_injury, practice_primary_injury) AS injury, practice_status "
        "FROM injury_reports "
        "WHERE season = $s AND week = $w AND report_status IN ('Out', 'Doubtful', 'Questionable') "
        "ORDER BY list_position($order, report_status), "
        "coalesce(list_position($skill, position), 99), team, player_name",
        {"s": season, "w": week, "order": list(INJURY_ORDER), "skill": list(SKILL_POSITIONS)},
    )
    counts = {s: 0 for s in INJURY_ORDER}
    for r in rows:
        counts[r["status"]] += 1
    return m.Injuries(
        season=season, week=week, counts=counts, rows=[m.InjuryRow(**r) for r in rows]
    )


def search_players(cur: duckdb.DuckDBPyConnection, q: str, limit: int) -> list[m.PlayerSummary]:
    rows = _rows(
        cur,
        "SELECT player_id, display_name, position, position_group, team, last_season "
        "FROM players "
        "WHERE display_name ILIKE '%' || $q || '%' "
        "ORDER BY (display_name ILIKE $q || '%') DESC, last_season DESC NULLS LAST, display_name "
        "LIMIT $n",
        {"q": q, "n": limit},
    )
    return [m.PlayerSummary(**r) for r in rows]


DEPTH_ORDER = ("behind_los", "short", "intermediate", "deep")


def qb_splits(
    cur: duckdb.DuckDBPyConnection, bio: dict[str, Any], season: int
) -> tuple[list[m.ThrowCell], list[m.DepthLine]]:
    """A quarterback's regular-season throw map and depth breakdown (empty for others).

    Spikes, sacks and scrambles are excluded (is_pass_attempt). Direction comes from
    play-by-play for every season; "misses" need FTN charting, so they are None before
    2022 rather than a misleading zero.
    """
    if bio["position_group"] != "QB":
        return [], []
    scope = {"id": bio["player_id"], "s": season}
    where = "passer_player_id = $id AND season = $s AND season_type = 'REG' AND is_pass_attempt"
    cells = [
        m.ThrowCell(**r)
        for r in _rows(
            cur,
            "SELECT depth_bucket AS depth, pass_location AS direction, "
            "count(*)::INTEGER AS attempts, avg(complete_pass) AS completion_rate, "
            "avg(epa) AS epa_per_attempt "
            f"FROM dropbacks WHERE {where} "
            "AND depth_bucket IN ('short', 'intermediate', 'deep') "
            "AND pass_location IN ('left', 'middle', 'right') "
            "GROUP BY depth_bucket, pass_location "
            "ORDER BY list_position($order, depth_bucket), pass_location",
            {**scope, "order": list(DEPTH_ORDER)},
        )
    ]
    depth = [
        m.DepthLine(**r)
        for r in _rows(
            cur,
            "SELECT depth_bucket AS depth, count(*)::INTEGER AS attempts, "
            "count(*) FILTER (WHERE complete_pass = 1)::INTEGER AS completions, "
            "CASE WHEN bool_or(is_charted) "
            "  THEN count(*) FILTER (WHERE is_inaccurate_incompletion)::INTEGER END AS misses "
            f"FROM dropbacks WHERE {where} AND depth_bucket IS NOT NULL "
            "GROUP BY depth_bucket ORDER BY list_position($order, depth_bucket)",
            {**scope, "order": list(DEPTH_ORDER)},
        )
    ]
    return cells, depth


def player_profile(
    cur: duckdb.DuckDBPyConnection, player_id: str, season: int | None
) -> m.PlayerProfile | None:
    bio = _one(cur, "SELECT * FROM players WHERE player_id = $id", {"id": player_id})
    if bio is None:
        return None
    seasons = [
        r[0]
        for r in cur.execute(
            "SELECT DISTINCT season FROM player_weeks WHERE player_id = $id ORDER BY season DESC",
            {"id": player_id},
        ).fetchall()
    ]
    if season not in seasons:
        season = seasons[0] if seasons else None

    stats = stats_for(groups_for(bio["position_group"]))
    columns = [
        m.StatColumn(key=s.key, label=s.label, short=s.short, group=s.group, decimals=s.decimals)
        for s in stats
    ]
    # Column names come from stats.py constants only.
    stat_cols = ", ".join(s.key for s in stats) or "NULL AS _none"
    sum_cols = ", ".join(f"sum({s.key}) AS {s.key}" for s in stats) or "NULL AS _none"

    weeks: list[m.WeekLine] = []
    totals: dict[str, float | None] = {}
    if season is not None:
        for r in _rows(
            cur,
            f"SELECT season_type, week, team, opponent_team, "
            f"coalesce(offense_snap_pct, defense_snap_pct) AS snap_pct, "
            f"injury_report_status, {stat_cols} "
            f"FROM player_weeks WHERE player_id = $id AND season = $s "
            f"ORDER BY season_type DESC, week",
            {"id": player_id, "s": season},
        ):
            weeks.append(
                m.WeekLine(
                    season_type=r["season_type"],
                    week=r["week"],
                    team=r["team"],
                    opponent=r["opponent_team"],
                    snap_pct=r["snap_pct"],
                    injury_status=r["injury_report_status"],
                    stats={s.key: r[s.key] for s in stats},
                )
            )
        tot = _one(
            cur,
            f"SELECT {sum_cols} FROM player_weeks "
            f"WHERE player_id = $id AND season = $s AND season_type = 'REG'",
            {"id": player_id, "s": season},
        )
        totals = {s.key: (tot or {}).get(s.key) for s in stats}

    career = [
        m.SeasonLine(
            season=r["season"],
            team=r["team"],
            games=r["games"],
            stats={s.key: r[s.key] for s in stats},
        )
        for r in _rows(
            cur,
            f"SELECT season, arg_max(team, week) AS team, count(*) AS games, {sum_cols} "
            f"FROM player_weeks WHERE player_id = $id AND season_type = 'REG' "
            f"GROUP BY season ORDER BY season DESC",
            {"id": player_id},
        )
    ]

    metrics: list[m.MetricValue] = []
    for name in PLAYER_METRICS.get(bio["position_group"] or "", ()):
        if season is None:
            break
        try:
            res = compute_metric(cur, name, player_id, season)
        except MetricError:
            continue  # e.g. a season before FTN charting began
        metrics.append(
            m.MetricValue(
                name=res.metric.name,
                label=res.metric.label,
                description=res.metric.description,
                unit=res.metric.unit,
                value=res.value,
                numerator=res.numerator_rows,
                denominator=res.denominator_rows,
            )
        )

    draft = None
    if bio["draft_year"]:
        draft = (
            f"{bio['draft_year']} round {bio['draft_round']}, pick {bio['draft_pick']} "
            f"({bio['draft_team']})"
            if bio["draft_round"]
            else f"{bio['draft_year']}, undrafted"
        )

    throw_map, depth = ([], []) if season is None else qb_splits(cur, bio, season)

    return m.PlayerProfile(
        player=m.PlayerSummary(
            player_id=bio["player_id"],
            display_name=bio["display_name"],
            position=bio["position"],
            position_group=bio["position_group"],
            team=bio["team"],
            last_season=bio["last_season"],
        ),
        college=bio["college"],
        height_in=bio["height_in"],
        weight_lb=bio["weight_lb"],
        years_of_experience=bio["years_of_experience"],
        draft=draft,
        season=season,
        seasons=seasons,
        columns=columns,
        totals=totals,
        weeks=weeks,
        career=career,
        metrics=metrics,
        throw_map=throw_map,
        depth=depth,
    )
