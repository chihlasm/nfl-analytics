"""FastAPI application: read-only endpoints for the dashboard.

Run locally:  uvicorn nfl_analytics.api.app:app --reload
In Docker the web container (Caddy) proxies /api/* here on port 8000.
"""

from __future__ import annotations

import logging
import os
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from typing import Annotated, Literal

import duckdb
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse

from nfl_analytics import __version__
from nfl_analytics.api import explorer, games, plays, queries, teams
from nfl_analytics.api import models as m
from nfl_analytics.api.db import Database, DatabaseUnavailable
from nfl_analytics.api.live import LiveScores
from nfl_analytics.api.news import NewsCache, news_from_env
from nfl_analytics.config import Settings
from nfl_analytics.logos import logo_path

log = logging.getLogger(__name__)

MIN_SEASON = 1999
MAX_SEASON = 2100


def _cursor(request: Request) -> Iterator[duckdb.DuckDBPyConnection]:
    """One read-only cursor per request, from the app's Database."""
    db: Database = request.app.state.db
    with db.cursor() as cur:
        yield cur


# Module level so FastAPI can resolve them (this module uses postponed annotations).
Cur = Annotated[duckdb.DuckDBPyConnection, Depends(_cursor)]
Season = Annotated[int | None, Query(ge=MIN_SEASON, le=MAX_SEASON)]
WeekParam = Annotated[int | None, Query(ge=0, le=30)]
Limit = Annotated[int, Query(ge=1, le=25)]
SearchText = Annotated[str, Query(min_length=2, max_length=60)]


def create_app(
    settings: Settings | None = None,
    news: NewsCache | None = None,
    *,
    start_news: bool = True,
    live: LiveScores | None = None,
) -> FastAPI:
    settings = settings or Settings.from_env()
    db = Database(settings.db_path)
    news = news or news_from_env()
    # Tests pass their own; otherwise live scores run alongside the news (and are
    # off entirely when NFL_LIVE_SCORES_URL is empty).
    live = live or LiveScores(url=settings.live_scores_url if start_news else "")

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        if start_news:
            news.start()
            live.start()
        yield
        news.stop()
        live.stop()

    app = FastAPI(
        title="NFL Analytics API",
        version=__version__,
        lifespan=lifespan,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
    )

    @app.exception_handler(DatabaseUnavailable)
    async def unavailable(_req: Request, exc: DatabaseUnavailable) -> JSONResponse:
        return JSONResponse(status_code=503, content={"detail": str(exc)})

    app.state.db = db

    def season_or_current(cur: duckdb.DuckDBPyConnection, season: int | None) -> int:
        return season if season is not None else queries.meta(cur).current_season

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    @app.get("/api/meta", response_model=m.Meta)
    def get_meta(cur: Cur) -> m.Meta:
        return queries.meta(cur)

    @app.get("/api/games", response_model=m.Week)
    def get_games(cur: Cur, season: Season = None, week: WeekParam = None) -> m.Week:
        # Live scores sit on top of the database's games until nflverse has the final.
        return live.apply(queries.week_games(cur, season_or_current(cur, season), week))

    @app.get("/api/games/{game_id}", response_model=m.GameDetail)
    def get_game(cur: Cur, game_id: str) -> m.GameDetail:
        detail = games.game_detail(cur, game_id, live)
        if detail is None:
            raise HTTPException(status_code=404, detail="No game with that id.")
        return detail

    @app.get("/api/stats", response_model=m.StatCatalog)
    def get_stats(cur: Cur) -> m.StatCatalog:
        return explorer.catalog(cur)

    @app.get("/api/explorer", response_model=m.Explorer)
    def get_explorer(
        cur: Cur,
        stat: Annotated[str, Query(max_length=40)] = "passing_yards",
        season: Season = None,
        season_type: Annotated[explorer.SeasonType, Query()] = "REG",
        position: Annotated[str | None, Query(max_length=4)] = None,
        team: Annotated[str | None, Query(pattern=r"^[A-Z]{2,3}$")] = None,
        min_games: Annotated[int, Query(ge=0, le=25)] = 0,
        sort: Annotated[explorer.Sort, Query()] = "total",
        order: Annotated[explorer.Order, Query()] = "desc",
        limit: Annotated[int, Query(ge=1, le=explorer.MAX_PAGE)] = 50,
        offset: Annotated[int, Query(ge=0, le=5000)] = 0,
        min_plays: Annotated[int | None, Query(ge=0, le=2000)] = None,
    ) -> m.Explorer:
        result = explorer.explore(
            cur,
            stat_key=stat,
            season=season_or_current(cur, season),
            season_type=season_type,
            position_group=position,
            team=team,
            min_games=min_games,
            sort=sort,
            order=order,
            limit=limit,
            offset=offset,
            min_plays=min_plays,
        )
        if result is None:
            raise HTTPException(status_code=404, detail="No stat with that name.")
        return result

    @app.get("/api/explorer/teams", response_model=m.TeamExplorer)
    def get_team_explorer(
        cur: Cur,
        stat: Annotated[str, Query(max_length=40)] = "epa_per_play",
        season: Season = None,
        season_type: Annotated[explorer.SeasonType, Query()] = "REG",
        conference: Annotated[Literal["AFC", "NFC"] | None, Query()] = None,
        order: Annotated[Literal["best", "worst"], Query()] = "best",
    ) -> m.TeamExplorer:
        result = explorer.explore_teams(
            cur,
            stat_key=stat,
            season=season_or_current(cur, season),
            season_type=season_type,
            conference=conference,
            best_first=order == "best",
        )
        if result is None:
            raise HTTPException(status_code=404, detail="No team stat with that name.")
        return result

    @app.get("/api/team-plays", response_model=m.PlayList)
    def get_team_plays(
        cur: Cur,
        team: Annotated[str, Query(pattern=r"^[A-Z]{2,3}$")],
        stat: Annotated[str, Query(max_length=40)],
        season: Season = None,
        season_type: Annotated[plays.SeasonType, Query()] = "REG",
        week: WeekParam = None,
        sort: Annotated[plays.Sort, Query()] = "time",
        counted_only: bool = False,
        limit: Annotated[int, Query(ge=1, le=plays.MAX_PAGE)] = 50,
        offset: Annotated[int, Query(ge=0, le=5000)] = 0,
    ) -> m.PlayList:
        result = plays.team_play_list(
            cur,
            key=stat,
            team=team,
            season=season_or_current(cur, season),
            season_type=season_type,
            week=week,
            sort=sort,
            counted_only=counted_only,
            limit=limit,
            offset=offset,
        )
        if result is None:
            raise HTTPException(
                status_code=404, detail="No plays for that team stat (points come from scores)."
            )
        return result

    @app.get("/api/plays", response_model=m.PlayList)
    def get_plays(
        cur: Cur,
        player: Annotated[str, Query(min_length=3, max_length=20)],
        stat: Annotated[str, Query(max_length=40)],
        season: Season = None,
        season_type: Annotated[plays.SeasonType, Query()] = "REG",
        week: WeekParam = None,
        team: Annotated[str | None, Query(pattern=r"^[A-Z]{2,3}$")] = None,
        sort: Annotated[plays.Sort, Query()] = "time",
        counted_only: bool = False,
        limit: Annotated[int, Query(ge=1, le=plays.MAX_PAGE)] = 50,
        offset: Annotated[int, Query(ge=0, le=5000)] = 0,
    ) -> m.PlayList:
        result = plays.play_list(
            cur,
            key=stat,
            player_id=player,
            season=season_or_current(cur, season),
            season_type=season_type,
            week=week,
            team=team,
            sort=sort,
            counted_only=counted_only,
            limit=limit,
            offset=offset,
        )
        if result is None:
            raise HTTPException(status_code=404, detail="No plays for that player and stat.")
        return result

    @app.get("/api/injuries", response_model=m.Injuries)
    def get_injuries(cur: Cur, season: Season = None) -> m.Injuries:
        return queries.injuries(cur, season_or_current(cur, season))

    @app.get("/api/players", response_model=list[m.PlayerSummary])
    def get_players(cur: Cur, q: SearchText, limit: Limit = 10) -> list[m.PlayerSummary]:
        return queries.search_players(cur, q.strip(), limit)

    @app.get("/api/players/{player_id}", response_model=m.PlayerProfile)
    def get_player(cur: Cur, player_id: str, season: Season = None) -> m.PlayerProfile:
        if len(player_id) > 20:
            raise HTTPException(status_code=404, detail="No player with that ID.")
        profile = queries.player_profile(cur, player_id, season)
        if profile is None:
            raise HTTPException(status_code=404, detail="No player with that ID.")
        return profile

    @app.get("/api/teams", response_model=m.Standings)
    def get_teams(cur: Cur, season: Season = None) -> m.Standings:
        return teams.standings(cur, season_or_current(cur, season))

    @app.get("/api/teams/{team}", response_model=m.TeamProfile)
    def get_team(cur: Cur, team: str, season: Season = None) -> m.TeamProfile:
        profile = teams.team_profile(cur, team, season)
        if profile is None:
            raise HTTPException(status_code=404, detail="No team with that code.")
        return profile

    @app.get("/api/teams/{team}/logo", response_class=FileResponse)
    def get_logo(team: str) -> FileResponse:
        """A team's logo, from the copy the ingest job cached (never fetched live)."""
        path = logo_path(settings.data_dir, team)
        if path is None or not path.is_file():
            raise HTTPException(status_code=404, detail="No logo for that team.")
        return FileResponse(
            path,
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff"},
        )

    @app.get("/api/news", response_model=m.News)
    def get_news() -> m.News:
        return news.snapshot()

    return app


def _app_from_env() -> FastAPI:
    logging.basicConfig(
        level=os.environ.get("NFL_LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )
    return create_app()


# `uvicorn nfl_analytics.api.app:app` imports this lazily via the factory below.
def app() -> FastAPI:  # pragma: no cover - exercised by uvicorn --factory
    return _app_from_env()
