from __future__ import annotations

from datetime import date

import pytest

from nfl_analytics.config import Settings, detect_current_season
from nfl_analytics.datasets import DATASETS, get_dataset, plan_files


@pytest.mark.parametrize(
    ("today", "season"),
    [
        (date(2026, 11, 16), 2026),
        (date(2027, 2, 7), 2026),  # Super Bowl belongs to the 2026 season
        (date(2027, 7, 31), 2026),
        (date(2027, 8, 1), 2027),
    ],
)
def test_detect_current_season(today: date, season: int) -> None:
    assert detect_current_season(today) == season


def test_settings_validate_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NFL_CURRENT_SEASON", "2026")
    monkeypatch.setenv("NFL_FIRST_SEASON", "1990")
    with pytest.raises(ValueError, match="earlier than 1999"):
        Settings.from_env()
    monkeypatch.setenv("NFL_FIRST_SEASON", "2016")
    monkeypatch.setenv("NFL_DOWNLOAD_WORKERS", "abc")
    with pytest.raises(ValueError, match="whole number"):
        Settings.from_env()
    monkeypatch.setenv("NFL_DOWNLOAD_WORKERS", "4")
    s = Settings.from_env()
    assert s.seasons == range(2016, 2027)


def test_dataset_urls() -> None:
    assert get_dataset("pbp").url(2026) == (
        "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2026.parquet"
    )
    assert get_dataset("schedules").url() == (
        "https://github.com/nflverse/nflverse-data/releases/download/schedules/games.parquet"
    )
    with pytest.raises(ValueError):
        get_dataset("pbp").url()


def test_dataset_names_and_tables_are_unique() -> None:
    assert len({d.name for d in DATASETS}) == len(DATASETS)
    assert len({d.table for d in DATASETS}) == len(DATASETS)


def test_plan_full_respects_each_datasets_first_season() -> None:
    files = list(plan_files(1999, 2026, current_only=False))
    by_ds: dict[str, list[int | None]] = {}
    for f in files:
        by_ds.setdefault(f.dataset.name, []).append(f.season)
    assert by_ds["pbp"] == list(range(1999, 2027))
    assert by_ds["ftn"] == list(range(2022, 2027))
    assert by_ds["snap_counts"][0] == 2012
    assert by_ds["injuries"][0] == 2009
    assert by_ds["players"] == [None]


def test_plan_daily_is_current_season_plus_all_season_files() -> None:
    files = list(plan_files(1999, 2026, current_only=True))
    seasons = {f.season for f in files}
    assert seasons == {2026, None}
    assert len([f for f in files if f.season is None]) == 5
