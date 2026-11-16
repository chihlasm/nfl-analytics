"""Command line entry point: `nfl <command>`.

nfl refresh [--full]   download what changed and rebuild the database once
nfl build              rebuild from the local cache only (no downloads)
nfl schedule           run forever: daily and weekly refreshes on cron schedules
nfl health             exit 0 if the last successful run is recent (Docker health check)
nfl status             print the last run's status
nfl metric NAME ...    compute a saved metric for a player
nfl query "SQL"        run a read-only query and print the result
"""

from __future__ import annotations

import argparse
import contextlib
import json
import logging
import signal
import sys
from datetime import UTC, datetime
from types import FrameType

from nfl_analytics.build import BuildError, build_database
from nfl_analytics.config import Settings
from nfl_analytics.metrics import MetricError, compute_metric, connect_readonly
from nfl_analytics.pipeline import Mode, read_status, run

log = logging.getLogger("nfl_analytics")


def _configure_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level, logging.INFO),
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S%z",
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("apscheduler").setLevel(logging.WARNING)


def cmd_refresh(settings: Settings, args: argparse.Namespace) -> int:
    status = run(settings, Mode.FULL if args.full else Mode.DAILY)
    print(json.dumps(status, indent=2, default=str))
    return 0


def cmd_build(settings: Settings, _: argparse.Namespace) -> int:
    report = build_database(settings)
    print(
        f"Built {report.db_path} in {report.seconds:.1f}s "
        f"(latest: {report.latest_season} week {report.latest_week})"
    )
    return 0


def cmd_schedule(settings: Settings, args: argparse.Namespace) -> int:
    from apscheduler.schedulers.blocking import BlockingScheduler
    from apscheduler.triggers.cron import CronTrigger

    def safe_run(mode: Mode) -> None:
        # A failed run is already logged and recorded in status.json (which turns the
        # container unhealthy). Swallow it so the scheduler keeps running.
        with contextlib.suppress(Exception):
            run(settings, mode)

    scheduler = BlockingScheduler(timezone=settings.timezone)
    scheduler.add_job(
        safe_run,
        CronTrigger.from_crontab(settings.daily_cron, timezone=settings.timezone),
        args=[Mode.DAILY],
        id="daily",
        max_instances=1,
        coalesce=True,
        misfire_grace_time=3600,
    )
    scheduler.add_job(
        safe_run,
        CronTrigger.from_crontab(settings.full_refresh_cron, timezone=settings.timezone),
        args=[Mode.FULL],
        id="full",
        max_instances=1,
        coalesce=True,
        misfire_grace_time=3600,
    )

    def shutdown(signum: int, _frame: FrameType | None) -> None:
        log.info("Received signal %d, shutting down", signum)
        scheduler.shutdown(wait=False)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    if not settings.db_path.exists() and not args.no_initial_run:
        log.info("No database yet: running an initial refresh before scheduling")
        safe_run(Mode.DAILY)

    log.info(
        "Scheduler started (%s): daily '%s', full '%s'",
        settings.timezone,
        settings.daily_cron,
        settings.full_refresh_cron,
    )
    scheduler.start()
    return 0


def cmd_health(settings: Settings, args: argparse.Namespace) -> int:
    status = read_status(settings)
    if not settings.db_path.exists():
        print("unhealthy: no database yet")
        return 1
    last = (status or {}).get("last_success_at")
    if not last:
        print("unhealthy: no successful run recorded")
        return 1
    age_h = (
        datetime.now(UTC) - datetime.fromisoformat(last.replace("Z", "+00:00"))
    ).total_seconds() / 3600
    if age_h > args.max_age_hours:
        print(f"unhealthy: last success {age_h:.1f}h ago (limit {args.max_age_hours}h)")
        return 1
    print(f"healthy: last success {age_h:.1f}h ago")
    return 0


def cmd_status(settings: Settings, _: argparse.Namespace) -> int:
    status = read_status(settings)
    print(json.dumps(status, indent=2) if status else "No runs recorded yet.")
    return 0


def cmd_metric(settings: Settings, args: argparse.Namespace) -> int:
    con = connect_readonly(settings.db_path)
    try:
        result = compute_metric(
            con,
            args.name,
            args.player,
            args.season,
            season_type=args.season_type,
            week_from=args.week_from,
            week_to=args.week_to,
        )
    finally:
        con.close()
    weeks = (
        f"weeks {result.week_from or 1}-{result.week_to}"
        if result.week_to
        else f"from week {result.week_from}"
        if result.week_from
        else "all weeks"
    )
    value = (
        "n/a"
        if result.value is None
        else (
            f"{result.value:.1%}"
            if result.metric.unit == "rate"
            else f"{result.value:.3f}"
            if result.metric.unit == "epa"
            else f"{result.value:.0f}"
        )
    )
    print(f"{result.metric.label}: {value}")
    print(
        f"  {result.player.display_name} ({result.player.position}, {result.player.team}), "
        f"{result.season} {result.season_type}, {weeks}"
    )
    if result.denominator_rows is not None:
        print(f"  {result.numerator_rows} of {result.denominator_rows} plays")
    return 0


def cmd_query(settings: Settings, args: argparse.Namespace) -> int:
    con = connect_readonly(settings.db_path)
    try:
        con.sql(args.sql).show(max_rows=args.limit, max_width=200)
    finally:
        con.close()
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="nfl", description="NFL Analytics data pipeline")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("refresh", help="download what changed and rebuild once")
    p.add_argument("--full", action="store_true", help="re-check every season, not just current")
    p.set_defaults(func=cmd_refresh)

    p = sub.add_parser("build", help="rebuild from the local cache (no downloads)")
    p.set_defaults(func=cmd_build)

    p = sub.add_parser("schedule", help="run the daily and weekly refresh schedule")
    p.add_argument(
        "--no-initial-run",
        action="store_true",
        help="do not refresh at startup even if there is no database",
    )
    p.set_defaults(func=cmd_schedule)

    p = sub.add_parser("health", help="exit 0 if the last success is recent")
    p.add_argument("--max-age-hours", type=float, default=30.0)
    p.set_defaults(func=cmd_health)

    p = sub.add_parser("status", help="print the last run's status")
    p.set_defaults(func=cmd_status)

    p = sub.add_parser("metric", help="compute a saved metric for a player")
    p.add_argument("name", help="metric name, e.g. short_throw_misses")
    p.add_argument("--player", required=True, help="player name or GSIS ID")
    p.add_argument("--season", type=int, required=True)
    p.add_argument("--season-type", choices=["REG", "POST", "ALL"], default="REG")
    p.add_argument("--week-from", type=int)
    p.add_argument("--week-to", type=int)
    p.set_defaults(func=cmd_metric)

    p = sub.add_parser("query", help="run a read-only SQL query")
    p.add_argument("sql")
    p.add_argument("--limit", type=int, default=50)
    p.set_defaults(func=cmd_query)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        settings = Settings.from_env()
    except ValueError as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        return 2
    _configure_logging(settings.log_level)
    try:
        return int(args.func(settings, args))
    except (MetricError, FileNotFoundError, BuildError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
