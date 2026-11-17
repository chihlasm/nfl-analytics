"""Shared fixtures: a tiny synthetic nflverse cache that exercises every view.

The fixture plays are designed so each saved-metric rule has a case that should
count and a case that should not (spike, throwaway, sack, catchable, deep).
"""

from __future__ import annotations

from pathlib import Path

import duckdb
import pytest

from nfl_analytics.api.stats import STATS
from nfl_analytics.config import Settings

SEASON = 2026
PREV = 2025
QB = "00-0039917"
WR = "00-0037238"
LB = "00-0034375"
GAME = "2026_05_ATL_BAL"


def _settings(data_dir: Path) -> Settings:
    return Settings(
        data_dir=data_dir,
        first_season=PREV,
        current_season=SEASON,
        timezone="America/New_York",
        daily_cron="0 6 * * *",
        full_refresh_cron="30 6 * * 3",
        download_workers=2,
        log_level="WARNING",
    )


# (play_id, week, air_yards, qb_dropback, pass_attempt, sack, qb_spike, incomplete,
#  receiver, catchable, throwaway, drop, n_blitzers, epa)
PLAYS = [
    # Counts as a short-throw miss.
    (1, 5, 5.0, 1, 1, 0, 0, 1, WR, False, False, False, 0, -0.8),
    (2, 5, 15.0, 1, 1, 0, 0, 1, WR, False, False, False, 2, -0.6),
    # Does NOT count: spike, throwaway, catchable (a drop), deep, complete, sack.
    (3, 5, 0.0, 0, 1, 0, 1, 1, None, False, False, False, 0, -0.1),
    (4, 5, 4.0, 1, 1, 0, 0, 1, None, False, True, False, 0, -0.3),
    (5, 5, 8.0, 1, 1, 0, 0, 1, WR, True, False, True, 0, -0.9),
    (6, 5, 25.0, 1, 1, 0, 0, 1, WR, False, False, False, 0, -0.7),
    (7, 6, 10.0, 1, 1, 0, 0, 0, WR, True, False, False, 1, 1.4),
    (8, 6, None, 1, 0, 1, 0, 0, None, None, None, None, 3, -2.1),
]


def _write(con: duckdb.DuckDBPyConnection, sql: str, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    con.execute(f"COPY ({sql}) TO '{path}' (FORMAT parquet)")


def write_fixture_cache(cache: Path) -> None:
    con = duckdb.connect()
    values = ",\n".join(
        "({}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {})".format(
            *(
                "NULL"
                if v is None
                else repr(v)
                if isinstance(v, str)
                else str(v).upper()
                if isinstance(v, bool)
                else v
                for v in p
            )
        )
        for p in PLAYS
    )
    con.execute(f"""
        CREATE TABLE fx AS SELECT * FROM (VALUES {values}) t(
            play_id, week, air_yards, qb_dropback, pass_attempt, sack, qb_spike,
            incomplete_pass, receiver_player_id, is_catchable_ball, is_throw_away,
            is_drop, n_blitzers, epa)
    """)

    pbp_cols = f"""
        '{GAME}' AS game_id, play_id::DOUBLE AS play_id, {SEASON} AS season,
        'REG' AS season_type, week, air_yards, qb_dropback::DOUBLE AS qb_dropback,
        pass_attempt::DOUBLE AS pass_attempt, sack::DOUBLE AS sack,
        qb_spike::DOUBLE AS qb_spike, incomplete_pass::DOUBLE AS incomplete_pass,
        receiver_player_id, '{QB}' AS passer_player_id, 'M.Penix' AS passer_player_name, epa,
        CASE WHEN pass_attempt = 1 AND sack = 0 AND incomplete_pass = 0 THEN 1.0 ELSE 0.0 END
            AS complete_pass,
        CASE WHEN play_id % 2 = 0 THEN 'right' ELSE 'left' END AS pass_location,
        'ATL' AS posteam, 'BAL' AS defteam,
        CASE WHEN qb_spike = 1 THEN 'qb_spike' ELSE 'pass' END AS play_type,
        CASE WHEN sack = 1 THEN -7.0
             WHEN pass_attempt = 1 AND incomplete_pass = 0 THEN coalesce(air_yards, 0) + 3
             ELSE 0.0 END AS yards_gained,
        CASE WHEN epa > 0 THEN 1.0 ELSE 0.0 END AS success,
        CASE WHEN play_id = 2 THEN 1.0 ELSE 0.0 END AS interception,
        0.0 AS fumble_lost, 0.0 AS two_point_attempt,
        -- Columns the plays panel and the play rules in stats.py read.
        CASE WHEN pass_attempt = 1 AND sack = 0 AND incomplete_pass = 0
             THEN coalesce(air_yards, 0) + 3 END AS passing_yards,
        CASE WHEN pass_attempt = 1 AND sack = 0 AND incomplete_pass = 0
             THEN coalesce(air_yards, 0) + 3 END AS receiving_yards,
        NULL::DOUBLE AS rushing_yards, 0.0 AS rush_attempt, 0.0 AS rush_touchdown,
        NULL::VARCHAR AS rusher_player_id,
        NULL::VARCHAR AS lateral_rusher_player_id, NULL::DOUBLE AS lateral_rushing_yards,
        NULL::VARCHAR AS lateral_receiver_player_id, NULL::DOUBLE AS lateral_receiving_yards,
        CASE WHEN play_id = 7 THEN 1.0 ELSE 0.0 END AS pass_touchdown,
        CASE WHEN play_id = 7 THEN 1.0 ELSE 0.0 END AS touchdown,
        CASE WHEN play_id = 7 THEN '{WR}' END AS td_player_id,
        epa AS qb_epa,
        CASE WHEN sack = 1 THEN '{LB}' END AS sack_player_id,
        NULL::VARCHAR AS half_sack_1_player_id, NULL::VARCHAR AS half_sack_2_player_id,
        CASE WHEN sack = 1 THEN '{LB}' END AS solo_tackle_1_player_id,
        NULL::VARCHAR AS solo_tackle_2_player_id,
        CASE WHEN sack = 1 THEN '{LB}' END AS qb_hit_1_player_id,
        NULL::VARCHAR AS qb_hit_2_player_id,
        CASE WHEN play_id = 2 THEN '{LB}' END AS interception_player_id,
        NULL::VARCHAR AS pass_defense_1_player_id, NULL::VARCHAR AS pass_defense_2_player_id,
        'BAL' AS home_team, 'ATL' AS away_team, 1.0 AS qtr, '10:00' AS time,
        1.0 AS down, 10.0 AS ydstogo, 'ATL 25' AS yrdln, 'Play ' || play_id AS "desc",
        0.0 AS penalty
    """
    _write(con, f"SELECT {pbp_cols} FROM fx", cache / "pbp" / f"play_by_play_{SEASON}.parquet")
    _write(
        con,
        f"SELECT {pbp_cols.replace(str(SEASON) + ' AS season', str(PREV) + ' AS season')} "
        "FROM fx WHERE play_id = 7",
        cache / "pbp" / f"play_by_play_{PREV}.parquet",
    )
    _write(
        con,
        f"""
        SELECT 1 AS ftn_game_id, '{GAME}' AS nflverse_game_id, {SEASON} AS season, week,
               play_id * 10 AS ftn_play_id, play_id AS nflverse_play_id, n_blitzers,
               is_catchable_ball, is_throw_away, is_drop, now() AS date_pulled
        FROM fx
    """,
        cache / "ftn" / f"ftn_charting_{SEASON}.parquet",
    )
    # Every dashboard stat gets a value: (catalog index % 7 + 1) x the row's weight w.
    stat_cols = ", ".join(f"{(i % 7) + 1}::DOUBLE * w AS {s.key}" for i, s in enumerate(STATS))
    _write(
        con,
        f"""
        SELECT player_id, player_display_name, position, team, opponent_team, season, week,
               season_type, {stat_cols}
        FROM (VALUES
            ('{QB}', 'Michael Penix Jr.', 'QB', 'ATL', 'BAL', {SEASON}, 5, 'REG', 1),
            ('{QB}', 'Michael Penix Jr.', 'QB', 'ATL', 'CHI', {SEASON}, 6, 'REG', 2),
            ('{WR}', 'Drake London', 'WR', 'ATL', 'BAL', {SEASON}, 5, 'REG', 3),
            ('{QB}', 'Michael Penix Jr.', 'QB', 'ATL', 'DET', {SEASON}, 19, 'POST', 4),
            ('{LB}', 'Roquan Smith', 'LB', 'BAL', 'ATL', {SEASON}, 5, 'REG', 1)
        ) t(player_id, player_display_name, position, team, opponent_team, season, week,
            season_type, w)
    """,
        cache / "player_week" / f"stats_player_week_{SEASON}.parquet",
    )
    _write(
        con,
        f"SELECT {SEASON} AS season, '{QB}' AS gsis_id, 'ATL' AS team",
        cache / "rosters" / f"roster_{SEASON}.parquet",
    )
    _write(
        con,
        f"""
        SELECT 'PeniMi00' AS pfr_player_id, {SEASON} AS season, 5 AS week,
               60 AS offense_snaps, 1.0 AS offense_pct, 0 AS defense_snaps, 0.0 AS defense_pct,
               0 AS st_snaps, 0.0 AS st_pct
    """,
        cache / "snap_counts" / f"snap_counts_{SEASON}.parquet",
    )
    _write(
        con,
        f"""
        SELECT '{QB}' AS gsis_id, {SEASON} AS season, 'REG' AS season_type, 6 AS week,
               'ATL' AS team, 'Michael Penix Jr.' AS full_name, 'QB' AS position,
               'Questionable' AS report_status, 'Knee' AS report_primary_injury,
               NULL::VARCHAR AS report_secondary_injury, 'Limited' AS practice_status,
               'Knee' AS practice_primary_injury
    """,
        cache / "injuries" / f"injuries_{SEASON}.parquet",
    )
    null_player_cols = ", ".join(
        f"NULL::{t} AS {c}"
        for c, t in [
            ("first_name", "VARCHAR"),
            ("last_name", "VARCHAR"),
            ("short_name", "VARCHAR"),
            ("football_name", "VARCHAR"),
            ("latest_team", "VARCHAR"),
            ("status", "VARCHAR"),
            ("jersey_number", "INTEGER"),
            ("height", "INTEGER"),
            ("weight", "INTEGER"),
            ("birth_date", "DATE"),
            ("college_name", "VARCHAR"),
            ("rookie_season", "INTEGER"),
            ("years_of_experience", "INTEGER"),
            ("draft_year", "INTEGER"),
            ("draft_round", "INTEGER"),
            ("draft_pick", "INTEGER"),
            ("draft_team", "VARCHAR"),
            ("headshot", "VARCHAR"),
            ("espn_id", "VARCHAR"),
            ("pff_id", "VARCHAR"),
            ("nfl_id", "VARCHAR"),
        ]
    )
    _write(
        con,
        f"""
        SELECT t.*, {null_player_cols} FROM (VALUES
            ('{QB}', 'Michael Penix Jr.', 'QB', 'QB', 'PeniMi00', {SEASON}),
            ('{WR}', 'Drake London', 'WR', 'WR', 'LondDr00', {SEASON}),
            ('{LB}', 'Roquan Smith', 'LB', 'LB', NULL, {SEASON}),
            ('00-0000001', 'Michael Penix Sr.', 'QB', 'QB', NULL, 1999)
        ) t(gsis_id, display_name, position, position_group, pfr_id, last_season)
    """,
        cache / "players" / "players.parquet",
    )
    _write(
        con,
        f"""
        SELECT '{GAME}' AS game_id, {SEASON} AS season, 'REG' AS game_type, 5 AS week,
               '2026-10-05' AS gameday, 'Sunday' AS weekday, '13:00' AS gametime,
               'BAL' AS home_team, 'ATL' AS away_team, 27 AS home_score, 20 AS away_score,
               7 AS result, 47 AS total, 0 AS overtime, 3.5 AS spread_line, 45.5 AS total_line,
               -170 AS home_moneyline, 145 AS away_moneyline, 0 AS div_game, 'outdoors' AS roof,
               'grass' AS surface, 61 AS temp, 8 AS wind, 'M&T Bank Stadium' AS stadium,
               'x' AS home_qb_id, 'L.Jackson' AS home_qb_name, '{QB}' AS away_qb_id,
               'M.Penix' AS away_qb_name, 'J.Harbaugh' AS home_coach, 'K.Stefanski' AS away_coach,
               'S.Smith' AS referee
    """,
        cache / "schedules" / "games.parquet",
    )
    _write(
        con,
        """
        SELECT * FROM (VALUES
            ('ATL', 'Atlanta Falcons', 'Falcons', 'NFC', 'NFC South', '#A71930', '#000000',
             'https://a.espncdn.com/i/teamlogos/nfl/500/atl.png'),
            ('BAL', 'Baltimore Ravens', 'Ravens', 'AFC', 'AFC North', '#241773', '#000000',
             'https://a.espncdn.com/i/teamlogos/nfl/500/bal.png'),
            ('OAK', 'Oakland Raiders', 'Raiders', 'AFC', 'AFC West', '#000000', '#A5ACAF',
             'https://a.espncdn.com/i/teamlogos/nfl/500/oak.png'),
            ('BAD', 'Bad Host', 'Bad', 'AFC', 'AFC West', '#000000', '#000000',
             'http://evil.example/logo.png')
        ) t(team_abbr, team_name, team_nick, team_conf, team_division, team_color,
            team_color2, team_logo_espn)
    """,
        cache / "teams" / "teams_colors_logos.parquet",
    )
    _write(
        con,
        f"""
        SELECT '{QB}' AS player_gsis_id, {SEASON} AS season, w AS week, 2.6 AS avg_time_to_throw,
               14.0 AS aggressiveness, 7.9 AS avg_intended_air_yards,
               1.5 AS completion_percentage_above_expectation
        FROM (VALUES (0), (5)) t(w)
    """,
        cache / "ngs_passing" / "ngs_passing.parquet",
    )
    _write(
        con,
        f"""
        SELECT '{WR}' AS player_gsis_id, {SEASON} AS season, 5 AS week, 3.1 AS avg_separation,
               6.0 AS avg_cushion, 0.4 AS avg_yac_above_expectation
    """,
        cache / "ngs_receiving" / "ngs_receiving.parquet",
    )
    _write(
        con,
        f"""
        SELECT 'nobody' AS player_gsis_id, {SEASON} AS season, 5 AS week, 3.9 AS efficiency,
               12.0 AS rush_yards_over_expected, 20.0 AS percent_attempts_gte_eight_defenders
    """,
        cache / "ngs_rushing" / "ngs_rushing.parquet",
    )
    con.close()


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return _settings(tmp_path / "data")


@pytest.fixture
def fixture_settings(settings: Settings) -> Settings:
    write_fixture_cache(settings.cache_dir)
    return settings
