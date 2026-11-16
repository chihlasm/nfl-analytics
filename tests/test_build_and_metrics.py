from __future__ import annotations

import duckdb
import pytest

from nfl_analytics.build import BuildError, build_database, load_sql
from nfl_analytics.config import Settings
from nfl_analytics.metrics import MetricError, compute_metric, connect_readonly, find_players

from .conftest import QB, SEASON


def test_build_publishes_database_with_all_views(fixture_settings: Settings) -> None:
    report = build_database(fixture_settings)

    assert fixture_settings.db_path.exists()
    assert report.latest_season == SEASON
    assert report.latest_week == 6
    con = connect_readonly(fixture_settings.db_path)
    try:
        for view in ("plays", "dropbacks", "targets", "games", "players", "player_weeks"):
            assert con.execute(f"SELECT count(*) FROM {view}").fetchone()[0] > 0, view
        # Joins never multiply rows.
        assert con.execute("SELECT count(*) FROM plays").fetchone()[0] == 9
        assert con.execute("SELECT count(*) FROM player_weeks").fetchone()[0] == 3
        info = con.execute("SELECT latest_season, latest_week FROM build_info").fetchone()
        assert info == (SEASON, 6)
    finally:
        con.close()


def test_player_weeks_attach_snaps_injuries_and_weekly_ngs_only(
    fixture_settings: Settings,
) -> None:
    build_database(fixture_settings)
    con = connect_readonly(fixture_settings.db_path)
    try:
        rows = con.execute(
            "SELECT week, offense_snaps, injury_report_status, ngs_cpoe FROM player_weeks "
            "WHERE player_id = ? ORDER BY week",
            [QB],
        ).fetchall()
    finally:
        con.close()
    # Week 5: snaps + NGS week 5 (the week-0 season total must not leak in).
    # Week 6: injury report only.
    assert rows == [(5, 60, None, 1.5), (6, None, "Questionable", None)]


def test_short_throw_misses_apply_every_rule(fixture_settings: Settings) -> None:
    build_database(fixture_settings)
    con = connect_readonly(fixture_settings.db_path)
    try:
        result = compute_metric(con, "short_throw_misses", "Michael Penix Jr.", SEASON)
        rate = compute_metric(con, "short_throw_miss_rate", QB, SEASON)
        week5 = compute_metric(con, "short_throw_misses", QB, SEASON, week_from=5, week_to=5)
        week6 = compute_metric(con, "short_throw_misses", QB, SEASON, week_from=6)
    finally:
        con.close()
    # Only plays 1 and 2 count: the spike, throwaway, catchable ball, deep ball,
    # completion and sack are all excluded.
    assert result.value == 2
    assert week5.value == 2 and week6.value == 0
    # Short attempts (15 air yards or less, not spikes/sacks): plays 1, 2, 4, 5, 7.
    assert rate.denominator_rows == 5
    assert rate.value == pytest.approx(2 / 5)


def test_receiver_drops_use_the_receiver_column(fixture_settings: Settings) -> None:
    build_database(fixture_settings)
    con = connect_readonly(fixture_settings.db_path)
    try:
        drops = compute_metric(con, "receiver_drops", "Drake London", SEASON)
    finally:
        con.close()
    assert drops.value == 1


def test_metric_errors_are_clear(fixture_settings: Settings) -> None:
    build_database(fixture_settings)
    con = connect_readonly(fixture_settings.db_path)
    try:
        with pytest.raises(MetricError, match="Unknown metric"):
            compute_metric(con, "nope", QB, SEASON)
        with pytest.raises(MetricError, match="No player"):
            compute_metric(con, "short_throw_misses", "Nobody Here", SEASON)
        with pytest.raises(MetricError, match="several players"):
            compute_metric(con, "short_throw_misses", "Penix", SEASON)
        with pytest.raises(MetricError, match="starts in 2022"):
            compute_metric(con, "short_throw_misses", QB, 2019)
        assert find_players(con, "penix")[0].display_name == "Michael Penix Jr."
    finally:
        con.close()


def test_failed_build_leaves_live_database_untouched(fixture_settings: Settings) -> None:
    build_database(fixture_settings)
    live = fixture_settings.db_path
    before = live.stat().st_ino

    # Remove a required dataset so the next build fails.
    for f in (fixture_settings.cache_dir / "schedules").glob("*.parquet"):
        f.unlink()
    with pytest.raises(BuildError, match="schedules"):
        build_database(fixture_settings)

    assert live.stat().st_ino == before
    assert not live.with_name(live.name + ".building").exists()
    con = duckdb.connect(str(live), read_only=True)
    assert con.execute("SELECT count(*) FROM plays").fetchone()[0] == 9
    con.close()


def test_rebuild_keeps_previous_database_for_rollback(fixture_settings: Settings) -> None:
    build_database(fixture_settings)
    build_database(fixture_settings)
    assert fixture_settings.db_path.with_name("nfl.duckdb.prev").exists()


def test_sql_files_split_on_separator_lines_only() -> None:
    statements = load_sql("views.sql")
    assert len(statements) == 6
    assert all(s.lstrip().startswith(("--", "CREATE")) for s in statements)
