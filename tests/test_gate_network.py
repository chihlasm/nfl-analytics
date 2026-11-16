"""Phase 1 gate, against REAL nflverse data. Slow (downloads ~500 MB): run with

    pytest -m network

Reference value, verified by hand on 2026-11-16: Michael Penix Jr. had 27
short-throw misses in 2026 Weeks 1-9 (an earlier hand count of 28 wrongly
included a Week 7 clock-stopping spike). Charting is final for those weeks, so
the number should not move; if nflverse or FTN revise a play, update it here
with a note.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from nfl_analytics.config import Settings
from nfl_analytics.metrics import compute_metric, connect_readonly
from nfl_analytics.pipeline import Mode, run

pytestmark = pytest.mark.network

PENIX_SHORT_THROW_MISSES_2026_WK1_9 = 27


def test_penix_short_throw_misses_gate(tmp_path_factory: pytest.TempPathFactory) -> None:
    data_dir = Path(os.environ.get("NFL_GATE_DATA_DIR") or tmp_path_factory.mktemp("gate"))
    settings = Settings(
        data_dir=data_dir,
        first_season=2022,
        current_season=2026,
        timezone="America/New_York",
        daily_cron="0 6 * * *",
        full_refresh_cron="30 6 * * 3",
        download_workers=4,
        log_level="INFO",
    )
    run(settings, Mode.DAILY)

    con = connect_readonly(settings.db_path)
    try:
        result = compute_metric(con, "short_throw_misses", "Michael Penix Jr.", 2026, week_to=9)
    finally:
        con.close()
    assert result.value == PENIX_SHORT_THROW_MISSES_2026_WK1_9
