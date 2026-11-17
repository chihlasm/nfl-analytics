"""One pipeline run: download what changed, rebuild the database, record the result.

Two modes:
  daily  current-season files + all-seasons files + anything missing from cache
  full   every file for every season (picks up nflverse corrections to old data)

A file lock makes sure two runs never overlap, even if a manual refresh is
started while the scheduled one is running. Every run, success or failure,
writes `status.json`, which the container health check reads.
"""

from __future__ import annotations

import fcntl
import json
import logging
import os
import time
from collections import Counter
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import Any

from nfl_analytics.build import build_database
from nfl_analytics.config import Settings
from nfl_analytics.datasets import FileSpec, get_dataset, plan_files
from nfl_analytics.download import cache_path, fetch_all, missing_from_cache
from nfl_analytics.logos import refresh_logos

log = logging.getLogger(__name__)


class Mode(StrEnum):
    DAILY = "daily"
    FULL = "full"


class PipelineBusy(RuntimeError):
    """Another run held the lock for longer than we were willing to wait."""


@contextmanager
def pipeline_lock(path: Path, *, wait_seconds: float) -> Iterator[None]:
    """Exclusive cross-process lock. Waits up to `wait_seconds` for a running job."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as fh:
        deadline = time.monotonic() + wait_seconds
        while True:
            try:
                fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise PipelineBusy(f"another pipeline run holds {path}") from None
                time.sleep(5)
        try:
            fh.write(str(os.getpid()))
            fh.flush()
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def write_status(settings: Settings, status: dict[str, Any]) -> None:
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    tmp = settings.status_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(status, indent=2, default=str))
    os.replace(tmp, settings.status_path)


def read_status(settings: Settings) -> dict[str, Any] | None:
    try:
        data = json.loads(settings.status_path.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def run(settings: Settings, mode: Mode, *, lock_wait_seconds: float = 3 * 3600) -> dict[str, Any]:
    """Run the pipeline once. Returns the status dict (also written to status.json)."""
    status: dict[str, Any] = {"mode": mode.value, "started_at": _now(), "ok": False}
    started = time.monotonic()
    previous = read_status(settings) or {}

    try:
        with pipeline_lock(settings.lock_path, wait_seconds=lock_wait_seconds):
            all_files = list(
                plan_files(settings.first_season, settings.current_season, current_only=False)
            )
            if mode is Mode.FULL:
                to_fetch = all_files
            else:
                wanted = {
                    s.label
                    for s in plan_files(
                        settings.first_season, settings.current_season, current_only=True
                    )
                }
                wanted |= {s.label for s in missing_from_cache(all_files, settings.cache_dir)}
                to_fetch = [s for s in all_files if s.label in wanted]

            log.info("%s refresh: checking %d file(s)", mode.value, len(to_fetch))
            results = fetch_all(
                to_fetch,
                settings.cache_dir,
                current_season=settings.current_season,
                workers=settings.download_workers,
            )
            counts = Counter(r.outcome.value for r in results)
            status["files"] = dict(counts)
            status["bytes_downloaded"] = sum(r.bytes for r in results)
            log.info("Downloads: %s", dict(counts))

            # Logos are cosmetic: record problems, never fail the data refresh.
            try:
                logos = refresh_logos(
                    settings.data_dir,
                    cache_path(settings.cache_dir, FileSpec(get_dataset("teams"), None)),
                    only_missing=mode is Mode.DAILY,
                )
                status["logos"] = logos.as_status()
            except Exception as exc:
                log.exception("Logo refresh failed")
                status["logos"] = {"error": f"{type(exc).__name__}: {exc}"}

            report = build_database(settings)
            status.update(
                ok=True,
                latest_season=report.latest_season,
                latest_week=report.latest_week,
                build_seconds=round(report.seconds, 1),
                tables={t.table: t.rows for t in report.tables},
            )
            status["last_success_at"] = _now()
    except Exception as exc:
        log.exception("Pipeline run failed")
        status["error"] = f"{type(exc).__name__}: {exc}"
        status["last_success_at"] = previous.get("last_success_at")
        raise
    finally:
        status["finished_at"] = _now()
        status["duration_seconds"] = round(time.monotonic() - started, 1)
        write_status(settings, status)
    return status
