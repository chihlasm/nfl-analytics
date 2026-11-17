"""Team queries: standings, a team's season, and league ranks.

Views only (team_games, team_weeks, teams, player_weeks, injury_reports);
every visitor value is a bound parameter.
"""

from __future__ import annotations

import re
from collections import defaultdict
from typing import Any

import duckdb

from nfl_analytics.api import models as m
from nfl_analytics.api import team_stats
from nfl_analytics.api.queries import INJURY_ORDER, SKILL_POSITIONS, _rows
from nfl_analytics.api.stats import STATS_BY_KEY

TEAM_CODE = re.compile(r"^[A-Z]{2,3}$")
# Current divisions began with the 2002 realignment (Houston joined, eight divisions).
DIVISIONS_SINCE = 2002

# Team leader boards, in order: the top three on this team for each.
TEAM_LEADER_CATEGORIES: tuple[str, ...] = (
    "passing_yards",
    "rushing_yards",
    "receiving_yards",
    "receptions",
    "def_sacks",
    "def_interceptions",
)
TEAM_LEADER_LIMIT = 3


def valid_team(team: str) -> bool:
    return bool(TEAM_CODE.match(team))


def _info(row: dict[str, Any], season: int) -> m.TeamInfo:
    aligned = season >= DIVISIONS_SINCE
    return m.TeamInfo(
        team=row["team"],
        name=row.get("name") or row["team"],
        nickname=row.get("nickname"),
        conference=row.get("conference") if aligned else None,
        division=row.get("division") if aligned else None,
    )


def _wlt(w: int, losses: int, t: int) -> str:
    return f"{w}-{losses}-{t}" if t else f"{w}-{losses}"


def _record(games: list[dict[str, Any]]) -> m.TeamRecord:
    """Regular-season record from a team's team_games rows (any order)."""
    played = sorted(
        (g for g in games if g["game_type"] == "REG" and g["result"]),
        key=lambda g: g["week"],
    )

    def count(rows: list[dict[str, Any]]) -> tuple[int, int, int]:
        return (
            sum(r["result"] == "W" for r in rows),
            sum(r["result"] == "L" for r in rows),
            sum(r["result"] == "T" for r in rows),
        )

    w, losses, t = count(played)
    streak = None
    if played:
        last = played[-1]["result"]
        n = 0
        for g in reversed(played):
            if g["result"] != last:
                break
            n += 1
        streak = f"{last}{n}"
    return m.TeamRecord(
        wins=w,
        losses=losses,
        ties=t,
        points_for=sum(g["points_for"] or 0 for g in played),
        points_against=sum(g["points_against"] or 0 for g in played),
        home=_wlt(*count([g for g in played if g["is_home"]])),
        away=_wlt(*count([g for g in played if not g["is_home"]])),
        division=_wlt(*count([g for g in played if g["is_division_game"]])),
        streak=streak,
    )


def _sort_key(row: m.StandingRow) -> tuple[float, int, str]:
    r = row.record
    games = r.wins + r.losses + r.ties
    pct = (r.wins + 0.5 * r.ties) / games if games else 0.0
    return (-pct, -(r.points_for - r.points_against), row.info.name)


def seasons_with_games(cur: duckdb.DuckDBPyConnection, team: str | None = None) -> list[int]:
    sql = "SELECT DISTINCT season FROM team_games"
    params: dict[str, Any] = {}
    if team:
        sql += " WHERE team = $t"
        params["t"] = team
    return [r[0] for r in cur.execute(sql + " ORDER BY season DESC", params).fetchall()]


def standings(cur: duckdb.DuckDBPyConnection, season: int) -> m.Standings:
    seasons = seasons_with_games(cur)
    games = _rows(
        cur,
        "SELECT g.*, t.name, t.nickname, t.conference, t.division "
        "FROM team_games g LEFT JOIN teams t USING (team) WHERE g.season = $s",
        {"s": season},
    )
    by_team: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for g in games:
        by_team[g["team"]].append(g)
    rows = [
        m.StandingRow(info=_info(team_games[0], season), record=_record(team_games))
        for team_games in by_team.values()
    ]
    rows.sort(key=_sort_key)
    return m.Standings(
        season=season,
        seasons=seasons,
        divisions_apply=season >= DIVISIONS_SINCE,
        teams=rows,
    )


def _ranks(cur: duckdb.DuckDBPyConnection, season: int, team: str) -> list[m.TeamRank]:
    """This team's place in the league on every team stat (regular season)."""
    out: list[m.TeamRank] = []
    for stat in team_stats.TEAM_STATS:
        values = team_stats.league_values(cur, stat, season)
        mine = next(((r, v) for r, v in team_stats.ranked(values, stat) if v.team == team), None)
        avg = sum(v.value for v in values) / len(values) if values else None
        out.append(
            m.TeamRank(
                key=stat.key,
                label=stat.label,
                side=stat.side,
                value=mine[1].value if mine else None,
                rank=mine[0] if mine else None,
                teams=len(values),
                league_avg=avg,
                decimals=stat.decimals,
                unit=stat.unit,
                has_plays=not stat.from_scores,
            )
        )
    return out


def _leaders(cur: duckdb.DuckDBPyConnection, season: int, team: str) -> list[m.LeaderBoard]:
    boards: list[m.LeaderBoard] = []
    for key in TEAM_LEADER_CATEGORIES:
        stat = STATS_BY_KEY[key]
        # `stat.key` is a trusted constant from stats.py, never visitor input.
        rows = _rows(
            cur,
            f"SELECT player_id, any_value(player_display_name) AS name, "
            f"any_value(position) AS position, $t AS team, "
            f"sum({stat.key}) AS value, count(*) AS games "
            f"FROM player_weeks WHERE season = $s AND season_type = 'REG' AND team = $t "
            f"GROUP BY player_id HAVING sum({stat.key}) > 0 "
            f"ORDER BY value DESC, name LIMIT $n",
            {"s": season, "t": team, "n": TEAM_LEADER_LIMIT},
        )
        boards.append(
            m.LeaderBoard(
                key=key,
                label=stat.label,
                decimals=stat.decimals,
                rows=[m.LeaderRow(**r) for r in rows],
            )
        )
    return boards


def _injuries(
    cur: duckdb.DuckDBPyConnection, season: int, team: str
) -> tuple[int | None, list[m.InjuryRow]]:
    row = cur.execute(
        "SELECT max(week) FROM injury_reports WHERE season = $s", {"s": season}
    ).fetchone()
    week = row[0] if row else None
    if week is None:
        return None, []
    rows = _rows(
        cur,
        "SELECT player_id, player_name, team, position, report_status AS status, "
        "coalesce(primary_injury, practice_primary_injury) AS injury, practice_status "
        "FROM injury_reports WHERE season = $s AND week = $w AND team = $t "
        "AND report_status IN ('Out', 'Doubtful', 'Questionable') "
        "ORDER BY list_position($order, report_status), "
        "coalesce(list_position($skill, position), 99), player_name",
        {
            "s": season,
            "w": week,
            "t": team,
            "order": list(INJURY_ORDER),
            "skill": list(SKILL_POSITIONS),
        },
    )
    return week, [m.InjuryRow(**r) for r in rows]


def team_profile(
    cur: duckdb.DuckDBPyConnection, team: str, season: int | None
) -> m.TeamProfile | None:
    if not valid_team(team):
        return None
    seasons = seasons_with_games(cur, team)
    if not seasons:
        return None
    if season not in seasons:
        season = seasons[0]

    table = standings(cur, season)
    me = next((r for r in table.teams if r.info.team == team), None)
    if me is None:  # pragma: no cover - seasons_with_games guarantees a row
        return None
    division: list[m.StandingRow] = []
    division_rank = None
    if table.divisions_apply and me.info.division:
        division = [r for r in table.teams if r.info.division == me.info.division]
        division_rank = next(i for i, r in enumerate(division, 1) if r.info.team == team)

    games = [
        m.TeamGame(**{k: r[k] for k in m.TeamGame.model_fields})
        for r in _rows(
            cur,
            "SELECT * FROM team_games WHERE team = $t AND season = $s "
            "ORDER BY game_type = 'REG' DESC, week",
            {"t": team, "s": season},
        )
    ]
    injury_week, injuries = _injuries(cur, season, team)
    return m.TeamProfile(
        info=me.info,
        season=season,
        seasons=seasons,
        record=me.record,
        division_rank=division_rank,
        division=division,
        games=games,
        ranks=_ranks(cur, season, team),
        leaders=_leaders(cur, season, team),
        injury_week=injury_week,
        injuries=injuries,
    )
