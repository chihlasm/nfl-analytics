"""Download nflverse files into a local cache, skipping files that have not changed.

Each cached file has a sidecar `<file>.meta.json` holding the server's ETag and
Last-Modified headers. Re-downloads send them back as a conditional request, so
an unchanged file costs one small HTTP round trip and no transfer.

Files are written to a temporary name and renamed into place, so a crash never
leaves a half-written Parquet file in the cache.
"""

from __future__ import annotations

import json
import logging
import os
import time
from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

import httpx

from nfl_analytics.datasets import FileSpec

log = logging.getLogger(__name__)

USER_AGENT = "nfl-analytics/0.1 (+https://github.com/chihlasm/nfl-analytics)"
TIMEOUT = httpx.Timeout(connect=15.0, read=120.0, write=30.0, pool=15.0)
MAX_ATTEMPTS = 4
RETRYABLE_STATUS = {429, 500, 502, 503, 504}


class Outcome(StrEnum):
    DOWNLOADED = "downloaded"
    UNCHANGED = "unchanged"
    NOT_PUBLISHED = "not_published"


@dataclass(frozen=True, slots=True)
class FileResult:
    spec: FileSpec
    outcome: Outcome
    path: Path | None
    bytes: int = 0


class DownloadError(RuntimeError):
    """A file that should exist could not be downloaded."""


def cache_path(cache_dir: Path, spec: FileSpec) -> Path:
    return cache_dir / spec.dataset.name / spec.file_name


def _meta_path(path: Path) -> Path:
    return path.with_name(path.name + ".meta.json")


def _read_meta(path: Path) -> dict[str, str]:
    meta = _meta_path(path)
    if not (path.exists() and meta.exists()):
        return {}
    try:
        data = json.loads(meta.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    return {k: v for k, v in data.items() if isinstance(v, str)}


def _write_meta(path: Path, response: httpx.Response) -> None:
    meta = {
        "url": str(response.url),
        "etag": response.headers.get("etag", ""),
        "last_modified": response.headers.get("last-modified", ""),
        "downloaded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    tmp = _meta_path(path).with_suffix(".tmp")
    tmp.write_text(json.dumps(meta, indent=2))
    os.replace(tmp, _meta_path(path))


def fetch_file(
    client: httpx.Client,
    spec: FileSpec,
    cache_dir: Path,
    *,
    allow_missing: bool,
) -> FileResult:
    """Download one file if it changed. Retries transient failures with backoff.

    `allow_missing=True` turns a 404 into NOT_PUBLISHED instead of an error. It is
    used for the current season, whose files appear only after its first game.
    """
    path = cache_path(cache_dir, spec)
    path.parent.mkdir(parents=True, exist_ok=True)

    headers: dict[str, str] = {}
    meta = _read_meta(path)
    if meta.get("etag"):
        headers["If-None-Match"] = meta["etag"]
    if meta.get("last_modified"):
        headers["If-Modified-Since"] = meta["last_modified"]

    last_error: Exception | None = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            with client.stream("GET", spec.url, headers=headers) as response:
                if response.status_code == 304:
                    return FileResult(spec, Outcome.UNCHANGED, path)
                if response.status_code == 404:
                    if allow_missing:
                        return FileResult(spec, Outcome.NOT_PUBLISHED, None)
                    raise DownloadError(f"{spec.label}: not found at {spec.url}")
                if response.status_code in RETRYABLE_STATUS:
                    raise httpx.HTTPStatusError(
                        f"HTTP {response.status_code}", request=response.request, response=response
                    )
                response.raise_for_status()

                tmp = path.with_name(path.name + ".part")
                size = 0
                with tmp.open("wb") as fh:
                    for chunk in response.iter_bytes(chunk_size=1 << 20):
                        fh.write(chunk)
                        size += len(chunk)
                expected = response.headers.get("content-length")
                if expected is not None and int(expected) != size:
                    tmp.unlink(missing_ok=True)
                    raise httpx.TransportError(f"truncated download ({size} of {expected} bytes)")
                os.replace(tmp, path)
                _write_meta(path, response)
                return FileResult(spec, Outcome.DOWNLOADED, path, size)
        except DownloadError:
            raise
        except (httpx.TransportError, httpx.HTTPStatusError) as exc:
            last_error = exc
            if attempt == MAX_ATTEMPTS:
                break
            delay = 2**attempt
            log.warning(
                "%s: attempt %d failed (%s); retrying in %ds", spec.label, attempt, exc, delay
            )
            time.sleep(delay)

    raise DownloadError(f"{spec.label}: failed after {MAX_ATTEMPTS} attempts: {last_error}")


def fetch_all(
    specs: Iterable[FileSpec],
    cache_dir: Path,
    *,
    current_season: int,
    workers: int = 4,
    client: httpx.Client | None = None,
) -> list[FileResult]:
    """Download files in parallel. Any hard failure raises after all workers finish."""
    specs = list(specs)
    own_client = client is None
    client = client or httpx.Client(
        timeout=TIMEOUT, follow_redirects=True, headers={"User-Agent": USER_AGENT}
    )
    results: list[FileResult] = []
    errors: list[str] = []
    try:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {
                pool.submit(
                    fetch_file,
                    client,
                    spec,
                    cache_dir,
                    allow_missing=spec.season == current_season,
                ): spec
                for spec in specs
            }
            for future in as_completed(futures):
                spec = futures[future]
                try:
                    result = future.result()
                except DownloadError as exc:
                    errors.append(str(exc))
                    continue
                results.append(result)
                log.debug("%s: %s", spec.label, result.outcome)
    finally:
        if own_client:
            client.close()

    if errors:
        raise DownloadError(
            f"{len(errors)} file(s) failed to download:\n  " + "\n  ".join(sorted(errors))
        )
    return sorted(results, key=lambda r: r.spec.label)


def missing_from_cache(specs: Iterable[FileSpec], cache_dir: Path) -> list[FileSpec]:
    """Files that have never been downloaded."""
    return [s for s in specs if not cache_path(cache_dir, s).exists()]
