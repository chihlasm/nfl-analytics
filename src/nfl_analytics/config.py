"""Runtime settings, read once from environment variables.

Every setting has a default so the pipeline runs with no configuration at all.
See `.env.example` for the documented list.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date
from pathlib import Path

# nflverse play-by-play starts in 1999; nothing in this project goes earlier.
EARLIEST_SEASON = 1999

# The NFL "season year" is the calendar year the season kicks off (September).
# From August on we treat the new year as current, so preseason checks find the
# upcoming season; a 404 for a not-yet-published current-season file is expected.
SEASON_ROLLOVER_MONTH = 8


def detect_current_season(today: date | None = None) -> int:
    """Return the NFL season year that is current on `today`."""
    today = today or date.today()
    return today.year if today.month >= SEASON_ROLLOVER_MONTH else today.year - 1


class DataDirError(RuntimeError):
    """The data folder is missing or not writable by the user the process runs as."""


def ensure_writable_dir(path: Path) -> None:
    """Create `path` if needed and prove we can write to it, with a fix in the error.

    The usual cause is a Docker bind mount whose host folder was auto-created by
    the Docker daemon (owned by root) while the container runs as UID 1000.
    """
    uid, gid = os.getuid(), os.getgid()
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / f".write-test-{os.getpid()}"
        probe.write_text("ok")
        probe.unlink()
    except OSError as exc:
        raise DataDirError(
            f"Cannot write to the data folder {path} as user {uid}:{gid} ({exc.strerror}). "
            f"On the Docker host, give that user ownership of the folder mounted at {path}, "
            f"for example: sudo chown -R {uid}:{gid} ./data  then restart the container."
        ) from exc


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be a whole number, got {raw!r}") from exc


def _env_str(name: str, default: str) -> str:
    raw = os.environ.get(name, "").strip()
    return raw or default


@dataclass(frozen=True, slots=True)
class Settings:
    data_dir: Path
    first_season: int
    current_season: int
    timezone: str
    daily_cron: str
    full_refresh_cron: str
    download_workers: int
    log_level: str

    @property
    def cache_dir(self) -> Path:
        """Downloaded Parquet files, one sub-folder per dataset."""
        return self.data_dir / "cache"

    @property
    def db_path(self) -> Path:
        """The live database that readers open (read-only)."""
        return self.data_dir / "nfl.duckdb"

    @property
    def status_path(self) -> Path:
        """Result of the last pipeline run, used by the health check."""
        return self.data_dir / "status.json"

    @property
    def lock_path(self) -> Path:
        return self.data_dir / ".pipeline.lock"

    @property
    def seasons(self) -> range:
        return range(self.first_season, self.current_season + 1)

    @classmethod
    def from_env(cls) -> Settings:
        current = _env_int("NFL_CURRENT_SEASON", detect_current_season())
        first = _env_int("NFL_FIRST_SEASON", EARLIEST_SEASON)
        if first < EARLIEST_SEASON:
            raise ValueError(f"NFL_FIRST_SEASON cannot be earlier than {EARLIEST_SEASON}")
        if first > current:
            raise ValueError("NFL_FIRST_SEASON cannot be later than the current season")
        workers = _env_int("NFL_DOWNLOAD_WORKERS", 4)
        if not 1 <= workers <= 16:
            raise ValueError("NFL_DOWNLOAD_WORKERS must be between 1 and 16")
        return cls(
            data_dir=Path(_env_str("NFL_DATA_DIR", "./data")).resolve(),
            first_season=first,
            current_season=current,
            timezone=_env_str("NFL_TIMEZONE", "America/New_York"),
            daily_cron=_env_str("NFL_DAILY_CRON", "0 6 * * *"),
            full_refresh_cron=_env_str("NFL_FULL_REFRESH_CRON", "30 6 * * 3"),
            download_workers=workers,
            log_level=_env_str("NFL_LOG_LEVEL", "INFO").upper(),
        )
