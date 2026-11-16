from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from nfl_analytics import cli, pipeline
from nfl_analytics.build import build_database
from nfl_analytics.config import Settings
from nfl_analytics.download import FileResult, Outcome
from nfl_analytics.pipeline import Mode, PipelineBusy, pipeline_lock, read_status, run


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
