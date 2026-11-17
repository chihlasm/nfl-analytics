"""Cache the 32 team logos on the server so the dashboard never fetches them itself.

The nflverse teams file links each team's official logo on ESPN's CDN. We
download them into `<data>/logos/<TEAM>.png`, and the API serves them from there.
That keeps the app working if a CDN changes, keeps viewers' browsing private,
and lets the dashboard's security policy allow images from its own origin only.

Safety: only https links on an allowed host are fetched, every file must start
with the PNG signature and stay under a size cap, and team codes are checked
before they become file names. Logos are cosmetic, so a failure here is logged
and recorded but never fails a data refresh.

Team logos are NFL trademarks. This project is private and for personal use.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

import duckdb
import httpx

from nfl_analytics.download import TIMEOUT, USER_AGENT, DownloadError, Outcome, fetch_url

log = logging.getLogger(__name__)

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAX_LOGO_BYTES = 2 * 1024 * 1024
ALLOWED_HOSTS = frozenset({"a.espncdn.com"})
TEAM_CODE = re.compile(r"^[A-Z]{2,3}$")
# Abbreviations nflverse keeps for relocated teams; the current code covers them.
HISTORICAL = frozenset({"OAK", "SD", "STL", "LAR"})


@dataclass(slots=True)
class LogoReport:
    downloaded: list[str] = field(default_factory=list)
    unchanged: list[str] = field(default_factory=list)
    failed: dict[str, str] = field(default_factory=dict)

    def as_status(self) -> dict[str, object]:
        return {
            "downloaded": len(self.downloaded),
            "unchanged": len(self.unchanged),
            "failed": self.failed,
        }


def logo_dir(data_dir: Path) -> Path:
    return data_dir / "logos"


def logo_path(data_dir: Path, team: str) -> Path | None:
    """Where a team's logo lives, or None for anything that isn't a team code."""
    if not TEAM_CODE.match(team):
        return None
    return logo_dir(data_dir) / f"{team}.png"


def is_png(head: bytes) -> bool:
    return head.startswith(PNG_SIGNATURE)


def _allowed(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme == "https" and parsed.hostname in ALLOWED_HOSTS


def logo_links(teams_parquet: Path) -> dict[str, str]:
    """team code -> logo URL, current teams only, straight from the cached teams file."""
    con = duckdb.connect()
    try:
        rows = con.execute(
            "SELECT team_abbr, team_logo_espn FROM read_parquet(?) "
            "WHERE team_abbr IS NOT NULL AND team_logo_espn IS NOT NULL",
            [str(teams_parquet)],
        ).fetchall()
    finally:
        con.close()
    return {str(t): str(u) for t, u in rows if str(t) not in HISTORICAL}


def refresh_logos(
    data_dir: Path,
    teams_parquet: Path,
    *,
    only_missing: bool,
    client: httpx.Client | None = None,
) -> LogoReport:
    """Download logos that are missing (daily) or changed (weekly full refresh)."""
    report = LogoReport()
    if not teams_parquet.exists():
        report.failed["*"] = "teams file not downloaded yet"
        return report

    own_client = client is None
    client = client or httpx.Client(
        timeout=TIMEOUT, follow_redirects=True, headers={"User-Agent": USER_AGENT}
    )
    try:
        for team, url in sorted(logo_links(teams_parquet).items()):
            path = logo_path(data_dir, team)
            if path is None:
                report.failed[team] = "not a team code"
                continue
            if not _allowed(url):
                report.failed[team] = "logo link is not on an allowed host"
                continue
            if only_missing and path.exists():
                report.unchanged.append(team)
                continue
            try:
                outcome, _size = fetch_url(
                    client,
                    url,
                    path,
                    label=f"logo/{team}",
                    allow_missing=False,
                    max_bytes=MAX_LOGO_BYTES,
                    check=is_png,
                )
            except DownloadError as exc:
                report.failed[team] = str(exc)
                continue
            if outcome is Outcome.DOWNLOADED:
                report.downloaded.append(team)
            else:
                report.unchanged.append(team)
    finally:
        if own_client:
            client.close()

    if report.failed:
        log.warning("Logos: %d failed: %s", len(report.failed), report.failed)
    log.info("Logos: %d downloaded, %d unchanged", len(report.downloaded), len(report.unchanged))
    return report
