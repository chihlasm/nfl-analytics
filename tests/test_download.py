from __future__ import annotations

from pathlib import Path

import httpx
import pytest

from nfl_analytics import download
from nfl_analytics.datasets import FileSpec, get_dataset
from nfl_analytics.download import DownloadError, Outcome, fetch_all, fetch_file

PAYLOAD = b"PAR1-fake-parquet-bytes"


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(download.time, "sleep", lambda _s: None)


def _client(handler: httpx.MockTransport) -> httpx.Client:
    return httpx.Client(transport=handler, follow_redirects=True)


def test_download_then_conditional_304(tmp_path: Path) -> None:
    seen_headers: list[dict[str, str]] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen_headers.append(dict(request.headers))
        if request.headers.get("if-none-match") == '"v1"':
            return httpx.Response(304)
        return httpx.Response(200, content=PAYLOAD, headers={"ETag": '"v1"'})

    spec = FileSpec(get_dataset("pbp"), 2025)
    with _client(httpx.MockTransport(handle)) as client:
        first = fetch_file(client, spec, tmp_path, allow_missing=False)
        second = fetch_file(client, spec, tmp_path, allow_missing=False)

    assert first.outcome is Outcome.DOWNLOADED and first.bytes == len(PAYLOAD)
    assert first.path is not None and first.path.read_bytes() == PAYLOAD
    assert second.outcome is Outcome.UNCHANGED
    assert seen_headers[1]["if-none-match"] == '"v1"'


def test_404_allowed_only_for_current_season(tmp_path: Path) -> None:
    transport = httpx.MockTransport(lambda r: httpx.Response(404))
    current = FileSpec(get_dataset("pbp"), 2026)
    past = FileSpec(get_dataset("pbp"), 2020)
    with _client(transport) as client:
        results = fetch_all([current], tmp_path, current_season=2026, client=client)
        assert results[0].outcome is Outcome.NOT_PUBLISHED
        with pytest.raises(DownloadError, match="play_by_play_2020"):
            fetch_all([past], tmp_path, current_season=2026, client=client)


def test_retries_transient_errors_then_succeeds(tmp_path: Path) -> None:
    calls = {"n": 0}

    def handle(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] < 3:
            return httpx.Response(503)
        return httpx.Response(200, content=PAYLOAD)

    spec = FileSpec(get_dataset("players"), None)
    with _client(httpx.MockTransport(handle)) as client:
        result = fetch_file(client, spec, tmp_path, allow_missing=False)
    assert result.outcome is Outcome.DOWNLOADED
    assert calls["n"] == 3


def test_gives_up_after_max_attempts_and_leaves_no_partial_file(tmp_path: Path) -> None:
    spec = FileSpec(get_dataset("players"), None)
    with (
        _client(httpx.MockTransport(lambda r: httpx.Response(502))) as client,
        pytest.raises(DownloadError, match="failed after"),
    ):
        fetch_file(client, spec, tmp_path, allow_missing=False)
    assert not list(tmp_path.rglob("*.parquet*"))


def test_truncated_download_is_rejected(tmp_path: Path) -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=PAYLOAD, headers={"Content-Length": "999"})

    spec = FileSpec(get_dataset("players"), None)
    with _client(httpx.MockTransport(handle)) as client, pytest.raises(DownloadError):
        fetch_file(client, spec, tmp_path, allow_missing=False)
    assert not (tmp_path / "players" / "players.parquet").exists()
