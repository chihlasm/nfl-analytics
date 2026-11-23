"""One game: a recap once its play-by-play is in, a matchup preview before that.

Recap: score by quarter, both teams' box score and advanced stats (advanced
ones come from api/team_stats.py filtered to this game, so they match the
league rankings and open their plays), win probability across the game, the
biggest swings, every scoring play, and each player's line.

Preview: records and form, each offense against the other defense with
league ranks and who has the edge, the teams side by side, past meetings,
key players and injuries.

Views only; the game id is checked against nflverse's format and bound.
"""

from __future__ import annotations

import re
from typing import Any

import duckdb

from nfl_analytics.api import models as m
from nfl_analytics.api import team_stats, teams
from nfl_analytics.api.explorer import stat_info
from nfl_analytics.api.live import LiveScores
from nfl_analytics.api.queries import _rows, game_from_row
from nfl_analytics.api.stats import STATS_BY_KEY

GAME_ID = re.compile(r"^\d{4}_\d{2}_[A-Z]{2,3}_[A-Z]{2,3}$")
MAX_WP_POINTS = 360
KEY_PLAYS = 8
FORM_GAMES = 5
MEETINGS = 6

# Per-game labels for team stats whose catalog names speak in season terms.
GAME_LABELS = {
    "pass_yards_per_game": "Net passing yards",  # after sack yardage, as the NFL reports it
    "rush_yards_per_game": "Rushing yards",
    "giveaways": "Turnovers",
}
BOX_FROM_CATALOG = ("yards_per_play", "pass_yards_per_game", "rush_yards_per_game",
                    "giveaways", "sacks_taken")  # fmt: skip
ADVANCED_FROM_CATALOG = ("epa_per_play", "dropback_epa", "rush_epa", "success_rate",
                         "early_down_success", "explosive_rate", "third_down_rate")  # fmt: skip

# Preview matchups: (label, offense stat, the defense stat it runs into).
MATCHUPS: tuple[tuple[str, str, str], ...] = (
    ("Points per game", "points_per_game", "points_allowed_per_game"),
    ("EPA per play", "epa_per_play", "epa_per_play_allowed"),
    ("EPA per dropback", "dropback_epa", "dropback_epa_allowed"),
    ("EPA per rush", "rush_epa", "rush_epa_allowed"),
    ("Success rate", "success_rate", "success_rate_allowed"),
    ("Early-down success", "early_down_success", "early_down_success_allowed"),
    ("Explosive play rate", "explosive_rate", "explosive_rate_allowed"),
    ("Third-down rate", "third_down_rate", "third_down_rate_allowed"),
    ("Passing yards per game", "pass_yards_per_game", "pass_yards_per_game_allowed"),
    ("Rushing yards per game", "rush_yards_per_game", "rush_yards_per_game_allowed"),
    ("Sacks", "sacks_taken", "sacks"),
    ("Turnovers", "giveaways", "takeaways"),
)

PLAYER_GROUPS: tuple[tuple[str, str, tuple[str, ...], str, str], ...] = (
    # key, label, columns, who appears (non-zero), order by
    ("passing", "Passing", ("completions", "attempts", "passing_yards", "passing_tds",
                            "passing_interceptions", "sacks_suffered", "passing_epa"),
     "attempts", "passing_yards"),
    ("rushing", "Rushing", ("carries", "rushing_yards", "rushing_tds"), "carries", "rushing_yards"),
    ("receiving", "Receiving", ("targets", "receptions", "receiving_yards", "receiving_tds",
                                "receiving_air_yards"), "targets", "receiving_yards"),
    ("defense", "Defense", ("def_tackles_solo", "def_sacks", "def_qb_hits", "def_interceptions",
                            "def_pass_defended"),
     "def_tackles_solo + def_sacks + def_qb_hits + def_interceptions + def_pass_defended",
     "def_tackles_solo"),
)  # fmt: skip


def valid_game_id(game_id: str) -> bool:
    return bool(GAME_ID.match(game_id))


def game_detail(
    cur: duckdb.DuckDBPyConnection, game_id: str, live: LiveScores | None = None
) -> m.GameDetail | None:
    """None for an id that isn't a game (the route returns 404)."""
    if not valid_game_id(game_id):
        return None
    rows = _rows(cur, "SELECT * FROM games WHERE game_id = $g", {"g": game_id})
    if not rows:
        return None
    row = rows[0]
    game = game_from_row(row)
    if live is not None:
        week = m.Week(season=game.season, week=game.week, weeks=[game.week], games=[game])
        game = live.apply(week).games[0]
    info = m.GameInfo(
        stadium=row["stadium"],
        roof=row["roof"],
        surface=row["surface"],
        temp_f=row["temp_f"],
        wind_mph=row["wind_mph"],
        home_coach=row["home_coach"],
        away_coach=row["away_coach"],
        referee=row["referee"],
        home_moneyline=row["home_moneyline"],
        away_moneyline=row["away_moneyline"],
        is_division_game=bool(row["is_division_game"]),
    )
    played = cur.execute("SELECT count(*) FROM plays WHERE game_id = $g", {"g": game_id}).fetchone()
    if played and played[0] > 0:
        return m.GameDetail(
            game=game, info=info, mode="recap", recap=_recap(cur, game), preview=None
        )
    return m.GameDetail(
        game=game, info=info, mode="preview", recap=None, preview=_preview(cur, game)
    )


# ------------------------------------------------------------------ recap


def _season_type(game: m.Game) -> team_stats.SeasonType:
    return "REG" if game.game_type == "REG" else "POST"


def _quarters(cur: duckdb.DuckDBPyConnection, game: m.Game) -> list[m.QuarterScore]:
    rows = cur.execute(
        "SELECT qtr, max(total_away_score), max(total_home_score) FROM plays "
        "WHERE game_id = $g AND qtr IS NOT NULL GROUP BY qtr ORDER BY qtr",
        {"g": game.game_id},
    ).fetchall()
    out: list[m.QuarterScore] = []
    away_before = home_before = 0
    for qtr, away_total, home_total in rows:
        away_now, home_now = int(away_total or 0), int(home_total or 0)
        q = int(qtr)
        label = str(q) if q <= 4 else ("OT" if q == 5 else f"{q - 4}OT")
        out.append(
            m.QuarterScore(label=label, away=away_now - away_before, home=home_now - home_before)
        )
        away_before, home_before = away_now, home_now
    # The official final wins: fold any difference into the last period.
    if out and game.is_final and game.away.score is not None and game.home.score is not None:
        last = out[-1]
        out[-1] = last.model_copy(
            update={
                "away": last.away + game.away.score - away_before,
                "home": last.home + game.home.score - home_before,
            }
        )
    return out


def _edge(away: float | None, home: float | None, higher_is_better: bool | None) -> str | None:
    if away is None or home is None or higher_is_better is None or away == home:
        return None
    return "away" if (away > home) == higher_is_better else "home"


def _box(cur: duckdb.DuckDBPyConnection, game: m.Game) -> dict[str, dict[str, Any]]:
    """Figures that aren't league-ranked team stats: totals and split counts, per team."""
    params = {"g": game.game_id}
    scrimmage = team_stats.SCRIMMAGE
    out: dict[str, dict[str, Any]] = {game.away.team: {}, game.home.team: {}}
    for team, yards, plays, firsts, third_c, third_a, fourth_c, fourth_a in cur.execute(
        f"""
        SELECT posteam,
               sum(yards_gained) FILTER (WHERE {scrimmage}),
               count(*) FILTER (WHERE {scrimmage}),
               sum(first_down),
               sum(third_down_converted) FILTER (WHERE down = 3 AND {scrimmage}),
               count(*) FILTER (WHERE down = 3 AND {scrimmage}),
               sum(fourth_down_converted) FILTER (WHERE down = 4 AND {scrimmage}),
               count(*) FILTER (WHERE down = 4 AND {scrimmage})
        FROM plays WHERE game_id = $g AND posteam IS NOT NULL GROUP BY posteam
        """,
        params,
    ).fetchall():
        if team in out:
            out[team].update(
                total_yards=float(yards or 0),
                plays=float(plays or 0),
                first_downs=float(firsts or 0),
                third_downs=(int(third_c or 0), int(third_a or 0)),
                fourth_downs=(int(fourth_c or 0), int(fourth_a or 0)),
            )
    for team, count, yards in cur.execute(
        "SELECT penalty_team, count(*), sum(penalty_yards) FROM plays "
        "WHERE game_id = $g AND penalty = 1 AND penalty_team IS NOT NULL GROUP BY 1",
        params,
    ).fetchall():
        if team in out:
            out[team]["penalties"] = (int(count), int(yards or 0))
    # One row per drive: who had it, how long, whether it reached the red zone and scored.
    for team, seconds, trips, tds in cur.execute(
        """
        WITH drives AS (
            SELECT posteam, fixed_drive,
                   any_value(drive_time_of_possession) AS top,
                   min(yardline_100) <= 20 AS red_zone,
                   any_value(fixed_drive_result) = 'Touchdown' AS td
            FROM plays WHERE game_id = $g AND posteam IS NOT NULL AND fixed_drive IS NOT NULL
            GROUP BY posteam, fixed_drive
        )
        SELECT posteam,
               sum(try_cast(split_part(top, ':', 1) AS INTEGER) * 60
                   + try_cast(split_part(top, ':', 2) AS INTEGER)),
               count(*) FILTER (WHERE red_zone),
               count(*) FILTER (WHERE red_zone AND td)
        FROM drives GROUP BY posteam
        """,
        params,
    ).fetchall():
        if team in out:
            out[team]["possession"] = int(seconds or 0)
            out[team]["red_zone"] = (int(tds or 0), int(trips or 0))
    return out


def _split(pair: tuple[int, int] | None) -> tuple[float | None, str | None]:
    if pair is None:
        return None, None
    made, tries = pair
    return (made / tries if tries else None), f"{made}/{tries}"


def _team_stats(cur: duckdb.DuckDBPyConnection, game: m.Game) -> list[m.GameStat]:
    away, home = game.away.team, game.home.team
    box = _box(cur, game)
    a, h = box[away], box[home]

    def row(key: str, label: str, av: Any, hv: Any, *, unit: str = "count", decimals: int = 0,
            better: bool | None = True, at: str | None = None, ht: str | None = None,
            group: str = "box") -> m.GameStat:  # fmt: skip
        return m.GameStat(
            key=key, label=label, group=group, away=av, home=hv, away_text=at, home_text=ht,
            unit=unit, decimals=decimals, higher_is_better=better,
            edge=_edge(av, hv, better), has_plays=False,
        )  # fmt: skip

    def catalog(key: str, group: str) -> m.GameStat:
        stat = team_stats.TEAM_STATS_BY_KEY[key]
        values = {
            v.team: v.value
            for v in team_stats.league_values(
                cur, stat, game.season, season_type=_season_type(game), game_id=game.game_id
            )
        }
        av, hv = values.get(away), values.get(home)
        return m.GameStat(
            key=key,
            label=GAME_LABELS.get(key, stat.label),
            group=group,
            away=av,
            home=hv,
            unit=stat.unit,
            decimals=stat.decimals if stat.combine != "per_game" else 0,
            higher_is_better=stat.higher_is_better,
            edge=_edge(av, hv, stat.higher_is_better),
            has_plays=True,
        )

    third_a, third_at = _split(a.get("third_downs"))
    third_h, third_ht = _split(h.get("third_downs"))
    fourth_a, fourth_at = _split(a.get("fourth_downs"))
    fourth_h, fourth_ht = _split(h.get("fourth_downs"))
    red_a, red_at = _split(a.get("red_zone"))
    red_h, red_ht = _split(h.get("red_zone"))
    pen_a, pen_h = a.get("penalties", (0, 0)), h.get("penalties", (0, 0))
    top_a, top_h = a.get("possession"), h.get("possession")

    def clock(seconds: int | None) -> str | None:
        return None if seconds is None else f"{seconds // 60}:{seconds % 60:02d}"

    stats = [
        row("total_yards", "Total yards", a.get("total_yards"), h.get("total_yards")),
        row("plays", "Plays", a.get("plays"), h.get("plays"), better=None),
        catalog("yards_per_play", "box"),
        row("first_downs", "First downs", a.get("first_downs"), h.get("first_downs")),
        catalog("pass_yards_per_game", "box"),
        catalog("rush_yards_per_game", "box"),
        row("third_downs", "Third downs", third_a, third_h, unit="rate", at=third_at, ht=third_ht),
        row(
            "fourth_downs",
            "Fourth downs",
            fourth_a,
            fourth_h,
            unit="rate",
            at=fourth_at,
            ht=fourth_ht,
        ),
        row("red_zone", "Red zone touchdowns", red_a, red_h, unit="rate", at=red_at, ht=red_ht),
        catalog("giveaways", "box"),
        catalog("sacks_taken", "box"),
        row(
            "penalties",
            "Penalties",
            float(pen_a[1]),
            float(pen_h[1]),
            better=False,
            at=f"{pen_a[0]} for {pen_a[1]}",
            ht=f"{pen_h[0]} for {pen_h[1]}",
        ),
        row("possession", "Time of possession", top_a, top_h, at=clock(top_a), ht=clock(top_h)),
    ]
    stats += [catalog(key, "advanced") for key in ADVANCED_FROM_CATALOG]
    return stats


def _win_probability(cur: duckdb.DuckDBPyConnection, game: m.Game) -> list[m.WinPoint]:
    rows = cur.execute(
        """
        SELECT CASE WHEN qtr <= 4 THEN 3600 - game_seconds_remaining
                    ELSE 3600 + 600 * (qtr - 5) + (600 - game_seconds_remaining) END AS t,
               home_wp
        FROM plays
        WHERE game_id = $g AND home_wp IS NOT NULL AND game_seconds_remaining IS NOT NULL
        ORDER BY play_id
        """,
        {"g": game.game_id},
    ).fetchall()
    if not rows:
        return []
    step = max(1, len(rows) // MAX_WP_POINTS)
    picked = rows[::step]
    if picked[-1] is not rows[-1]:
        picked.append(rows[-1])
    points = [m.WinPoint(t=max(0, int(t)), home_wp=float(wp)) for t, wp in picked]
    # The final word: a finished game ends at 100% for the winner (or 50% for a tie).
    if game.is_final and game.away.score is not None and game.home.score is not None:
        end = 1.0 if game.home.score > game.away.score else 0.0
        end = 0.5 if game.home.score == game.away.score else end
        points.append(m.WinPoint(t=points[-1].t, home_wp=end))
    return points


_PLAY_SELECT = """
    play_id, qtr, "time", posteam, "desc", wpa, home_team,
    total_away_score, total_home_score, touchdown, field_goal_result, safety,
    interception, fumble_lost
"""


def _game_play(r: dict[str, Any], score: tuple[int, int] | None = None) -> m.GamePlay:
    kind = None
    if r["touchdown"]:
        kind = "TD"
    elif r["field_goal_result"] == "made":
        kind = "FG"
    elif r["safety"]:
        kind = "Safety"
    elif r["interception"] or r["fumble_lost"]:
        kind = "Turnover"
    change = None
    if r["wpa"] is not None and r["posteam"] is not None:
        change = float(r["wpa"]) if r["posteam"] == r["home_team"] else -float(r["wpa"])
    away_score, home_score = score if score else (r["total_away_score"], r["total_home_score"])
    return m.GamePlay(
        play_id=int(r["play_id"]),
        qtr=None if r["qtr"] is None else int(r["qtr"]),
        clock=r["time"],
        team=r["posteam"],
        description=r["desc"],
        home_wp_change=change,
        away_score=None if away_score is None else int(away_score),
        home_score=None if home_score is None else int(home_score),
        kind=kind,
    )


def _key_plays(cur: duckdb.DuckDBPyConnection, game: m.Game) -> list[m.GamePlay]:
    rows = _rows(
        cur,
        f"SELECT {_PLAY_SELECT} FROM plays WHERE game_id = $g AND wpa IS NOT NULL "
        "AND posteam IS NOT NULL ORDER BY abs(wpa) DESC LIMIT $n",
        {"g": game.game_id, "n": KEY_PLAYS},
    )
    return [_game_play(r) for r in rows]


def _scoring_plays(cur: duckdb.DuckDBPyConnection, game: m.Game) -> list[m.GamePlay]:
    """Every score, with the score once the extra point or two-point try is done."""
    rows = _rows(
        cur,
        f"SELECT {_PLAY_SELECT} FROM plays WHERE game_id = $g ORDER BY play_id",
        {"g": game.game_id},
    )
    scoring = [
        i for i, r in enumerate(rows)
        if r["touchdown"] or r["field_goal_result"] == "made" or r["safety"]
    ]  # fmt: skip
    out: list[m.GamePlay] = []
    for n, i in enumerate(scoring):
        # Running totals are after each play, so the score "after" a touchdown is the
        # last total before the next score (that includes the try that followed).
        end = scoring[n + 1] - 1 if n + 1 < len(scoring) else len(rows) - 1
        last = rows[end]
        score = (int(last["total_away_score"] or 0), int(last["total_home_score"] or 0))
        if n + 1 == len(scoring) and game.is_final and game.away.score is not None:
            score = (game.away.score, game.home.score or 0)
        out.append(_game_play(rows[i], score))
    return out


def _players(cur: duckdb.DuckDBPyConnection, game: m.Game) -> list[m.PlayerGroup]:
    groups: list[m.PlayerGroup] = []
    for key, label, columns, appears, order in PLAYER_GROUPS:
        cols = ", ".join(columns)  # trusted constants (stats.py keys)
        rows = _rows(
            cur,
            f"SELECT player_id, player_display_name AS name, position, team, {cols} "
            f"FROM player_weeks WHERE game_id = $g AND coalesce({appears}, 0) > 0 "
            f"ORDER BY {order} DESC NULLS LAST, name",
            {"g": game.game_id},
        )
        lines: dict[str, list[m.PlayerLine]] = {game.away.team: [], game.home.team: []}
        for r in rows:
            if r["team"] in lines:
                lines[r["team"]].append(
                    m.PlayerLine(
                        player_id=r["player_id"],
                        name=r["name"] or r["player_id"],
                        position=r["position"],
                        stats={c: float(r[c] or 0) for c in columns},
                    )
                )
        groups.append(
            m.PlayerGroup(
                key=key,
                label=label,
                columns=[stat_info(STATS_BY_KEY[c]) for c in columns],
                away=lines[game.away.team],
                home=lines[game.home.team],
            )
        )
    return groups


def _recap(cur: duckdb.DuckDBPyConnection, game: m.Game) -> m.GameRecap:
    return m.GameRecap(
        quarters=_quarters(cur, game),
        team_stats=_team_stats(cur, game),
        win_probability=_win_probability(cur, game),
        key_plays=_key_plays(cur, game),
        scoring_plays=_scoring_plays(cur, game),
        players=_players(cur, game),
    )


# ---------------------------------------------------------------- preview


def _stats_season(cur: duckdb.DuckDBPyConnection, game: m.Game) -> tuple[int, str | None]:
    """This season's numbers, or last season's before anyone has played this year."""
    row = cur.execute(
        "SELECT count(*) FROM team_games WHERE season = $s AND game_type = 'REG' AND is_final",
        {"s": game.season},
    ).fetchone()
    if row and row[0] > 0:
        return game.season, None
    return game.season - 1, f"No {game.season} games yet, so these are {game.season - 1} numbers."


def _ranks(
    cur: duckdb.DuckDBPyConnection, season: int
) -> dict[str, tuple[dict[str, tuple[int, float]], int]]:
    """stat key -> (team -> (rank, value), teams ranked), regular season."""
    keys = {k for _, off, deff in MATCHUPS for k in (off, deff)}
    out: dict[str, tuple[dict[str, tuple[int, float]], int]] = {}
    for key in keys:
        stat = team_stats.TEAM_STATS_BY_KEY[key]
        values = team_stats.league_values(cur, stat, season)
        out[key] = ({v.team: (r, v.value) for r, v in team_stats.ranked(values, stat)}, len(values))
    return out


def _matchup(
    ranks: dict[str, tuple[dict[str, tuple[int, float]], int]],
    label: str,
    away: str,
    away_key: str,
    home: str,
    home_key: str,
) -> m.MatchupRow:
    stat = team_stats.TEAM_STATS_BY_KEY[away_key]
    away_table, teams_n = ranks[away_key]
    home_table, _ = ranks[home_key]
    ar, av = away_table.get(away, (None, None))
    hr, hv = home_table.get(home, (None, None))
    edge = None
    if ar is not None and hr is not None and ar != hr:
        edge = "away" if ar < hr else "home"
    return m.MatchupRow(
        label=label,
        away_key=away_key,
        home_key=home_key,
        away_value=av,
        away_rank=ar,
        home_value=hv,
        home_rank=hr,
        unit=stat.unit,
        decimals=stat.decimals,
        teams=teams_n,
        edge=edge,
    )


def _form(cur: duckdb.DuckDBPyConnection, team: str, game: m.Game) -> list[str]:
    rows = cur.execute(
        "SELECT result FROM team_games WHERE team = $t AND is_final AND result IS NOT NULL "
        "AND (game_date < $d OR $d IS NULL) ORDER BY game_date DESC LIMIT $n",
        {"t": team, "d": game.game_date, "n": FORM_GAMES},
    ).fetchall()
    return [str(r[0]) for r in reversed(rows)]


def _meetings(cur: duckdb.DuckDBPyConnection, game: m.Game) -> list[m.Meeting]:
    """Past games between these two teams, newest first."""
    rows = _rows(
        cur,
        # Rows from this page's away team's side; turned into host/guest below.
        "SELECT game_id, season, week, game_type, game_date, is_home, points_for, "
        "points_against FROM team_games WHERE team = $a AND opponent = $h AND is_final "
        "AND game_id <> $g ORDER BY game_date DESC LIMIT $n",
        {"a": game.away.team, "h": game.home.team, "g": game.game_id, "n": MEETINGS},
    )
    out = []
    for r in rows:
        ours, theirs = r["points_for"], r["points_against"]
        hosted = bool(r["is_home"])  # did this page's away team host that one?
        winner = None
        if ours is not None and theirs is not None and ours != theirs:
            winner = game.away.team if ours > theirs else game.home.team
        out.append(
            m.Meeting(
                game_id=r["game_id"],
                season=r["season"],
                week=r["week"],
                game_type=r["game_type"],
                game_date=r["game_date"],
                home=game.away.team if hosted else game.home.team,
                away_score=theirs if hosted else ours,
                home_score=ours if hosted else theirs,
                winner=winner,
            )
        )
    return out


def _preview(cur: duckdb.DuckDBPyConnection, game: m.Game) -> m.GamePreview:
    away, home = game.away.team, game.home.team
    season, note = _stats_season(cur, game)
    ranks = _ranks(cur, season)
    table = teams.standings(cur, season)
    records = {r.info.team: r.record for r in table.teams}
    side = [
        _matchup(ranks, f"{label} (offense)", away, off, home, off) for label, off, _ in MATCHUPS
    ] + [
        _matchup(ranks, f"{label} (defense)", away, deff, home, deff) for label, _, deff in MATCHUPS
    ]
    injury_week, away_injuries = teams._injuries(cur, game.season, away)
    _, home_injuries = teams._injuries(cur, game.season, home)
    return m.GamePreview(
        stats_season=season,
        stats_note=note,
        away_record=records.get(away),
        home_record=records.get(home),
        away_form=_form(cur, away, game),
        home_form=_form(cur, home, game),
        away_offense=[
            _matchup(ranks, label, away, off, home, deff) for label, off, deff in MATCHUPS
        ],
        home_offense=[
            _matchup(ranks, label, away, deff, home, off) for label, off, deff in MATCHUPS
        ],
        side_by_side=side,
        meetings=_meetings(cur, game),
        away_leaders=teams._leaders(cur, season, away),
        home_leaders=teams._leaders(cur, season, home),
        injury_week=injury_week,
        away_injuries=away_injuries,
        home_injuries=home_injuries,
    )
