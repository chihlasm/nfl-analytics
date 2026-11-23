from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from nfl_analytics import cli, pipeline
from nfl_analytics.build import build_database
from nfl_analytics.config import Settings
from nfl_analytics.download import FileResult, Outcome
from nfl_analytics.logos import LogoReport
from nfl_analytics.pipeline import Mode, PipelineBusy, pipeline_lock, read_status, run


@pytest.fixture(autouse=True)
def no_logo_downloads(monkeypatch: pytest.MonkeyPatch) -> None:
    """Pipeline tests never touch the network for logos (tests/test_logos.py covers them)."""
    monkeypatch.setattr(pipeline, "refresh_logos", lambda *a, **k: LogoReport(unchanged=["ATL"]))


def test_logo_failure_never_fails_the_run(
    fixture_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(pipeline, "fetch_all", lambda specs, *a, **k: [])

    def broken(*_a, **_k):  # type: ignore[no-untyped-def]
        raise RuntimeError("CDN down")

    monkeypatch.setattr(pipeline, "refresh_logos", broken)
    status = run(fixture_settings, Mode.DAILY)
    assert status["ok"] is True
    assert "CDN down" in status["logos"]["error"]


def test_daily_run_fetches_current_season_and_missing_files(
    fixture_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    requested: list[str] = []

    def fake_fetch_all(specs, cache_dir, **_kw):  # type: ignore[no-untyped-def]
        specs = list(specs)
        requested.extend(s.label for s in specs)
        return [FileResult(s, Outcome.UNCHANGED, None) for s in specs]

    monkeypatch.setattr(pipeline, "fetch_all", fake_fetch_all)
    status = run(fixture_settings, Mode.DAILY)

    assert status["ok"] is True
    assert status["latest_week"] == 6
    assert "pbp/play_by_play_2026.parquet" in requested
    # 2025 pbp is cached already, so the daily run skips it ...
    assert "pbp/play_by_play_2025.parquet" not in requested
    # ... but 2025 FTN was never downloaded, so it is fetched.
    assert "ftn/ftn_charting_2025.parquet" in requested
    assert read_status(fixture_settings)["last_success_at"]


def test_failed_run_records_error_and_keeps_last_success(
    fixture_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(pipeline, "fetch_all", lambda specs, *a, **k: [])
    first = run(fixture_settings, Mode.DAILY)

    def boom(*_a, **_k):  # type: ignore[no-untyped-def]
        raise RuntimeError("network down")

    monkeypatch.setattr(pipeline, "fetch_all", boom)
    with pytest.raises(RuntimeError):
        run(fixture_settings, Mode.FULL)

    status = read_status(fixture_settings)
    assert status is not None
    assert status["ok"] is False
    assert "network down" in status["error"]
    assert status["last_success_at"] == first["last_success_at"]


def test_lock_prevents_overlapping_runs(tmp_path: Path) -> None:
    lock = tmp_path / "lock"
    with (
        pipeline_lock(lock, wait_seconds=0),
        pytest.raises(PipelineBusy),
        pipeline_lock(lock, wait_seconds=0),
    ):
        pass


def _write_status(settings: Settings, hours_ago: float) -> None:
    ts = (datetime.now(UTC) - timedelta(hours=hours_ago)).strftime("%Y-%m-%dT%H:%M:%SZ")
    settings.status_path.write_text(json.dumps({"ok": True, "last_success_at": ts}))


def test_health_check(fixture_settings: Settings, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NFL_DATA_DIR", str(fixture_settings.data_dir))
    monkeypatch.setenv("NFL_CURRENT_SEASON", "2026")
    monkeypatch.setenv("NFL_FIRST_SEASON", "2025")

    assert cli.main(["health"]) == 1  # no database yet
    build_database(fixture_settings)
    _write_status(fixture_settings, hours_ago=2)
    assert cli.main(["health"]) == 0
    _write_status(fixture_settings, hours_ago=40)
    assert cli.main(["health"]) == 1


def test_metric_command(
    fixture_settings: Settings, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("NFL_DATA_DIR", str(fixture_settings.data_dir))
    monkeypatch.setenv("NFL_CURRENT_SEASON", "2026")
    monkeypatch.setenv("NFL_FIRST_SEASON", "2025")
    build_database(fixture_settings)

    code = cli.main(
        ["metric", "short_throw_misses", "--player", "Michael Penix Jr.", "--season", "2026"]
    )
    assert code == 0
    assert "Short-throw misses: 2" in capsys.readouterr().out
    assert cli.main(["metric", "nope", "--player", "x", "--season", "2026"]) == 1


def test_unwritable_data_dir_fails_fast_with_fix(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    def denied(self: Path, *_a: object, **_k: object) -> None:
        raise PermissionError(13, "Permission denied")

    # Simulate a root-owned bind mount (works even when tests run as root).
    monkeypatch.setattr(Path, "write_text", denied)
    monkeypatch.setenv("NFL_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("NFL_CURRENT_SEASON", "2026")

    assert cli.main(["schedule", "--no-initial-run"]) == 1
    assert "sudo chown" in caplog.text
    assert "Permission denied" in caplog.text


def test_check_with_nothing_new_keeps_the_database(
    fixture_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    def unchanged(specs, cache_dir, **_kw):  # type: ignore[no-untyped-def]
        return [FileResult(s, Outcome.UNCHANGED, None) for s in specs]

    monkeypatch.setattr(pipeline, "fetch_all", unchanged)
    first = run(fixture_settings, Mode.DAILY)
    assert first["rebuilt"] is True  # no database yet
    built = fixture_settings.db_path.stat().st_mtime_ns

    second = run(fixture_settings, Mode.DAILY)
    assert second["ok"] is True and second["rebuilt"] is False
    assert second["latest_week"] == first["latest_week"]
    assert second["data_changed_at"] == first["data_changed_at"]
    assert fixture_settings.db_path.stat().st_mtime_ns == built  # untouched

    assert run(fixture_settings, Mode.DAILY, force_build=True)["rebuilt"] is True


def test_check_with_a_new_file_rebuilds(
    fixture_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    outcome = {"value": Outcome.UNCHANGED}

    def fake(specs, cache_dir, **_kw):  # type: ignore[no-untyped-def]
        return [FileResult(s, outcome["value"], None) for s in specs]

    monkeypatch.setattr(pipeline, "fetch_all", fake)
    run(fixture_settings, Mode.DAILY)
    outcome["value"] = Outcome.DOWNLOADED
    assert run(fixture_settings, Mode.DAILY)["rebuilt"] is True


def test_busy_check_skips_without_touching_status(
    fixture_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(pipeline, "fetch_all", lambda specs, *a, **k: [])
    run(fixture_settings, Mode.DAILY)
    before = fixture_settings.status_path.read_text()
    with pipeline_lock(fixture_settings.lock_path, wait_seconds=0), pytest.raises(PipelineBusy):
        run(fixture_settings, Mode.DAILY, lock_wait_seconds=0)
    assert fixture_settings.status_path.read_text() == before  # still healthy


def test_check_schedules_parse(monkeypatch: pytest.MonkeyPatch) -> None:
    from apscheduler.triggers.cron import CronTrigger

    from nfl_analytics.config import DEFAULT_CHECK_CRONS

    for expr in DEFAULT_CHECK_CRONS:
        CronTrigger.from_crontab(expr, timezone="America/New_York")
    monkeypatch.setenv("NFL_CHECK_CRONS", "*/10 * * * sun; 0 9 * * *")
    assert Settings.from_env().check_crons == ("*/10 * * * sun", "0 9 * * *")
    monkeypatch.setenv("NFL_LIVE_SCORES_URL", "")
    assert Settings.from_env().live_scores_url.startswith("https://")  # blank = default
    monkeypatch.setenv("NFL_LIVE_SCORES_URL", "off")
    assert Settings.from_env().live_scores_url == ""
