from __future__ import annotations

from collections.abc import Iterator

import httpx
import pytest
from fastapi.testclient import TestClient

from nfl_analytics import download
from nfl_analytics.api.app import create_app
from nfl_analytics.api.news import NewsCache
from nfl_analytics.build import build_database
from nfl_analytics.config import Settings
from nfl_analytics.logos import PNG_SIGNATURE, logo_path, refresh_logos

PNG = PNG_SIGNATURE + b"fake-image-bytes"


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(download.time, "sleep", lambda _s: None)


def _teams(settings: Settings):  # type: ignore[no-untyped-def]
    return settings.cache_dir / "teams" / "teams_colors_logos.parquet"


def test_downloads_current_team_logos_and_skips_unsafe_ones(fixture_settings: Settings) -> None:
    requested: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requested.append(str(request.url))
        if request.headers.get("if-none-match") == '"v1"':
            return httpx.Response(304)
        return httpx.Response(200, content=PNG, headers={"ETag": '"v1"'})

    client = httpx.Client(transport=httpx.MockTransport(handle))
    report = refresh_logos(
        fixture_settings.data_dir, _teams(fixture_settings), only_missing=False, client=client
    )

    assert sorted(report.downloaded) == ["ATL", "BAL"]
    # OAK is a historical code (skipped); BAD links to a non-https, non-ESPN host.
    assert "OAK" not in report.downloaded + report.unchanged
    assert "BAD" in report.failed and "allowed host" in report.failed["BAD"]
    assert not any("evil.example" in u for u in requested)
    path = logo_path(fixture_settings.data_dir, "ATL")
    assert path is not None and path.read_bytes() == PNG

    # Weekly re-check: conditional requests, nothing re-downloaded.
    again = refresh_logos(
        fixture_settings.data_dir, _teams(fixture_settings), only_missing=False, client=client
    )
    assert sorted(again.unchanged) == ["ATL", "BAL"] and again.downloaded == []

    # Daily: logos already on disk are not requested at all.
    requested.clear()
    daily = refresh_logos(
        fixture_settings.data_dir, _teams(fixture_settings), only_missing=True, client=client
    )
    assert sorted(daily.unchanged) == ["ATL", "BAL"]
    assert requested == []


def test_rejects_non_png_and_oversized_files(fixture_settings: Settings) -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        if "atl" in request.url.path:
            return httpx.Response(200, content=b"<html>not an image</html>")
        return httpx.Response(200, content=PNG_SIGNATURE + b"x" * (3 * 1024 * 1024))

    client = httpx.Client(transport=httpx.MockTransport(handle))
    report = refresh_logos(
        fixture_settings.data_dir, _teams(fixture_settings), only_missing=False, client=client
    )

    assert "unexpected content" in report.failed["ATL"]
    assert "larger than" in report.failed["BAL"]
    assert not list((fixture_settings.data_dir / "logos").glob("*.png*"))


def test_logo_path_only_accepts_team_codes(settings: Settings) -> None:
    assert logo_path(settings.data_dir, "ATL") is not None
    for bad in ("../etc/passwd", "atl", "ATLX", "A", "AT L", "ATL.png"):
        assert logo_path(settings.data_dir, bad) is None


@pytest.fixture
def client(fixture_settings: Settings) -> Iterator[TestClient]:
    build_database(fixture_settings)
    logos = fixture_settings.data_dir / "logos"
    logos.mkdir(parents=True, exist_ok=True)
    (logos / "ATL.png").write_bytes(PNG)
    app = create_app(fixture_settings, NewsCache(feeds=[]), start_news=False)
    with TestClient(app) as c:
        yield c


def test_api_serves_cached_logos(client: TestClient) -> None:
    r = client.get("/api/teams/ATL/logo")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert "max-age=86400" in r.headers["cache-control"]
    assert r.content == PNG


def test_api_logo_404s_for_missing_or_invalid_teams(client: TestClient) -> None:
    assert client.get("/api/teams/BAL/logo").status_code == 404  # not downloaded
    assert client.get("/api/teams/atl/logo").status_code == 404  # not a team code
    assert client.get("/api/teams/..%2F..%2Fnfl.duckdb/logo").status_code == 404


def test_teams_view(fixture_settings: Settings) -> None:
    build_database(fixture_settings)
    import duckdb

    con = duckdb.connect(str(fixture_settings.db_path), read_only=True)
    try:
        row = con.execute("SELECT name, division FROM teams WHERE team = 'ATL'").fetchone()
    finally:
        con.close()
    assert row == ("Atlanta Falcons", "NFC South")
