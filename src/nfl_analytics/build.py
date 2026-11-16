"""Build the DuckDB database from the Parquet cache, validate it, and swap it in.

The build always writes a NEW file (`nfl.duckdb.building`). Only after every
table loads, every view compiles and every check passes is it moved over the
live `nfl.duckdb` with an atomic rename. Readers therefore never see a partial
database, and a failed build leaves yesterday's data untouched.

The previous database is kept as `nfl.duckdb.prev` for a one-step rollback.
"""

from __future__ import annotations

import logging
import os
import re
import time
from dataclasses import dataclass, field
from importlib import resources
from pathlib import Path

import duckdb

from nfl_analytics.config import Settings
from nfl_analytics.datasets import DATASETS, Dataset, FileSpec
from nfl_analytics.download import cache_path

log = logging.getLogger(__name__)

SQL_FILES = ("views.sql", "metrics.sql")
# A line containing only "-- ;;" separates statements in the bundled SQL files.
STATEMENT_SEPARATOR = re.compile(r"^--\s*;;\s*$", re.MULTILINE)
CORE_VIEWS = ("plays", "dropbacks", "targets", "games", "players", "player_weeks")


class BuildError(RuntimeError):
    """The new database failed to build or failed validation. The live DB is untouched."""


@dataclass(slots=True)
class TableStats:
    dataset: str
    table: str
    rows: int
    files: int
    min_season: int | None = None
    max_season: int | None = None


@dataclass(slots=True)
class BuildReport:
    db_path: Path
    seconds: float
    tables: list[TableStats] = field(default_factory=list)
    latest_season: int | None = None
    latest_week: int | None = None


def cached_files(dataset: Dataset, settings: Settings) -> list[Path]:
    """Cached Parquet files for a dataset within the configured season range."""
    if dataset.per_season:
        specs = [
            FileSpec(dataset, s)
            for s in dataset.seasons(settings.first_season, settings.current_season)
        ]
    else:
        specs = [FileSpec(dataset, None)]
    return [p for p in (cache_path(settings.cache_dir, s) for s in specs) if p.exists()]


def load_sql(name: str) -> list[str]:
    """Split a bundled SQL file into statements on the `-- ;;` separator."""
    text = resources.files("nfl_analytics.sql").joinpath(name).read_text(encoding="utf-8")
    return [chunk.strip() for chunk in STATEMENT_SEPARATOR.split(text) if chunk.strip()]


def _load_raw_tables(con: duckdb.DuckDBPyConnection, settings: Settings) -> list[TableStats]:
    stats: list[TableStats] = []
    for ds in DATASETS:
        files = cached_files(ds, settings)
        if not files:
            raise BuildError(
                f"No cached files for dataset '{ds.name}'. Run a refresh to download them."
            )
        started = time.monotonic()
        con.execute(
            f"CREATE TABLE {ds.table} AS SELECT * FROM read_parquet($files, union_by_name = true)",
            {"files": [str(f) for f in files]},
        )
        rows = _scalar_int(con, f"SELECT count(*) FROM {ds.table}")
        if rows == 0:
            raise BuildError(f"Table {ds.table} loaded 0 rows from {len(files)} file(s)")
        table_stats = TableStats(ds.name, ds.table, rows, len(files))
        if _has_column(con, ds.table, "season"):
            lo, hi = con.execute(f"SELECT min(season), max(season) FROM {ds.table}").fetchone() or (
                None,
                None,
            )
            table_stats.min_season, table_stats.max_season = lo, hi
        stats.append(table_stats)
        log.info(
            "Loaded %-18s %10s rows from %3d file(s) in %.1fs",
            ds.table,
            f"{rows:,}",
            len(files),
            time.monotonic() - started,
        )
    return stats


def _run_sql_files(con: duckdb.DuckDBPyConnection) -> None:
    for name in SQL_FILES:
        for i, statement in enumerate(load_sql(name), start=1):
            try:
                con.execute(statement)
            except duckdb.Error as exc:
                first_line = statement.splitlines()[0] if statement else ""
                raise BuildError(f"{name} statement {i} failed ({first_line}...): {exc}") from exc


def _validate(con: duckdb.DuckDBPyConnection) -> tuple[int | None, int | None]:
    """Sanity checks on the finished database. Raises BuildError on any failure."""
    problems: list[str] = []

    for view in CORE_VIEWS:
        try:
            if _scalar_int(con, f"SELECT count(*) FROM {view}") == 0:
                problems.append(f"view {view} is empty")
        except duckdb.Error as exc:
            problems.append(f"view {view} failed to query: {exc}")

    # Joins must never multiply rows.
    pairs = (("plays", "raw_pbp"), ("player_weeks", "raw_player_week"))
    for view, base in pairs:
        try:
            v = _scalar_int(con, f"SELECT count(*) FROM {view}")
            b = _scalar_int(con, f"SELECT count(*) FROM {base}")
        except duckdb.Error as exc:
            problems.append(f"row-count check {view} vs {base} failed: {exc}")
            continue
        if v != b:
            problems.append(f"{view} has {v:,} rows but {base} has {b:,} (a join duplicated rows)")

    if _scalar_int(con, "SELECT count(*) FROM metric_definitions") == 0:
        problems.append("metric_definitions is empty")

    if problems:
        raise BuildError("Validation failed:\n  " + "\n  ".join(problems))

    row = con.execute(
        "SELECT season, max(week) FROM raw_pbp "
        "WHERE season = (SELECT max(season) FROM raw_pbp) GROUP BY season"
    ).fetchone()
    return (row[0], row[1]) if row else (None, None)


def _write_meta(con: duckdb.DuckDBPyConnection, report: BuildReport, settings: Settings) -> None:
    con.execute(
        "CREATE TABLE build_info AS SELECT "
        "now() AS built_at, $first AS first_season, $current AS current_season, "
        "$latest_season AS latest_season, $latest_week AS latest_week",
        {
            "first": settings.first_season,
            "current": settings.current_season,
            "latest_season": report.latest_season,
            "latest_week": report.latest_week,
        },
    )
    con.execute(
        "CREATE TABLE dataset_status (dataset VARCHAR, raw_table VARCHAR, row_count BIGINT, "
        "file_count INTEGER, min_season INTEGER, max_season INTEGER)"
    )
    con.executemany(
        "INSERT INTO dataset_status VALUES (?, ?, ?, ?, ?, ?)",
        [(t.dataset, t.table, t.rows, t.files, t.min_season, t.max_season) for t in report.tables],
    )


def build_database(settings: Settings) -> BuildReport:
    """Build, validate and atomically publish a new database from the cache."""
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    live = settings.db_path
    building = live.with_name(live.name + ".building")
    previous = live.with_name(live.name + ".prev")
    for leftover in (building, building.with_name(building.name + ".wal")):
        leftover.unlink(missing_ok=True)

    started = time.monotonic()
    report = BuildReport(db_path=live, seconds=0.0)
    con = duckdb.connect(str(building))
    try:
        con.execute("SET preserve_insertion_order = false")
        report.tables = _load_raw_tables(con, settings)
        _run_sql_files(con)
        report.latest_season, report.latest_week = _validate(con)
        _write_meta(con, report, settings)
        con.execute("CHECKPOINT")
    except Exception:
        con.close()
        building.unlink(missing_ok=True)
        raise
    con.close()

    # Keep the old database as .prev, then atomically replace the live file.
    # The hard link means the live path always points at a complete database.
    if live.exists():
        previous.unlink(missing_ok=True)
        os.link(live, previous)
    os.replace(building, live)

    report.seconds = time.monotonic() - started
    log.info(
        "Published %s in %.1fs (latest: %s week %s)",
        live,
        report.seconds,
        report.latest_season,
        report.latest_week,
    )
    return report


def _scalar_int(con: duckdb.DuckDBPyConnection, sql: str) -> int:
    row = con.execute(sql).fetchone()
    return int(row[0]) if row and row[0] is not None else 0


def _has_column(con: duckdb.DuckDBPyConnection, table: str, column: str) -> bool:
    row = con.execute(
        "SELECT count(*) FROM information_schema.columns WHERE table_name = ? AND column_name = ?",
        [table, column],
    ).fetchone()
    return bool(row and row[0])
