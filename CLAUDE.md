# CLAUDE.md: guide for Claude sessions working on this repo

## Who and what
- Owner: Michael (chihlasm). He is not a developer and relies on Claude for expert,
  production-quality code. Explain decisions in plain language; never take a shortcut
  just because it is easier.
- Project: self-hosted NFL analytics on his Proxmox homelab (docker-01 VM, Docker +
  Dockge, Caddy, Tailscale). Placeholder name "NFL Analytics", future URL nfl.chihlas.com.
- GitHub is the source of truth for this repo (Gitea pull-mirrors from it).

## Roadmap (each gate must pass before the next phase)
1. Data foundation: done in this repo's first release. Gate: Penix 2026 Weeks 1-9
   short-throw misses = 27 (`pytest -m network`).
2. MCP server (Python) giving Claude read-only tools: describe_data, find_player,
   find_team, player_splits, compare, run_metric, list_plays, latest_news, query_sql
   (SELECT only, 5,000-row cap, 10 s timeout). Auth should match his WePlan MCP
   connector. Gate: chat answers come from the database.
3. Dashboard: frontend stack must MATCH his WePlan app (repo chihlasm/weplan): check
   it before choosing anything. League-wide home (news feed, scores, leaders,
   injuries and transactions), Player, Team, Explorer pages; tapping any stat shows its
   plays; dark-first and phone-first. News: RSS headlines only (headline, source, time,
   link; never article text), polled every 15 minutes, names matched to player/team IDs.
4. Compare page, saved views, fantasy and betting views.

Phase 3a (done, ahead of Phase 2 at Michael's request): `api` service
(`src/nfl_analytics/api`) and `web/` dashboard with Home (scores, headlines, leaders,
injuries), player search and player pages.
Phase 3b so far: Teams (standings by division/conference/league) and Team pages (schedule
with byes, game-by-game margins, league ranks, division table, injuries, leaders).
`TeamLink` makes team names open their page; never nest it inside another link.
Explorer v1 (`/explorer`, `GET /api/explorer`, catalog at `GET /api/stats`): rank every
player on any catalog stat with season, season type, team, position group and min-games
filters, total or per-game, highest or lowest, paged 50 at a time. All filters live in
the URL. Home leaders use it (stat dropdown + "See all" link into the Explorer).
Plays behind any number (done): `GET /api/plays` (player + stat or metric, season, type,
week, team; time or biggest-first; rates can list counted plays only). Box-score stats use
the play rules in `api/stats.py` (`plays`, `play_value`, `scope`), checked against nflverse
box scores (2026: exact for the top 40 on all 20 stats). The response carries the official
total too, and the UI says so when old data disagrees. `PlaysSheet` (one native dialog in
the shell) is driven by `play_*` URL params via `lib/plays.ts`; wrap any number that has
plays in `StatTap` (inline or block). Advanced stats are in the catalog and the Explorer
(rates and averages qualify at 50 plays by default; seasons before charting get a note).
Team stats (done): `api/team_stats.py` defines every team stat once (which scrimmage
plays count, from the offense's or defense's side, what each adds, and how they combine:
mean, per game or total). League ranks, the team page's ranks, `GET /api/explorer/teams`
and `GET /api/team-plays` all use it; points come from final scores (`team_games`) and
have no plays list. Checked equal to `team_weeks` for all 32 teams. Ranks are always
league ranks (1st = best), also when listing worst first or filtering a conference.
The Explorer has a Players/Teams switch (`subject=teams` in the URL); the plays panel
takes `play_subject=team` + `play_team`.
Game pages (done): `/games/:gameId` (`GET /api/games/{game_id}`, `api/games.py`). Score cards,
compact rows, the ticker and team schedules all open it (cards are one link, so no TeamLinks
inside them). Played games get a recap: scoring by quarter, win probability, box score and
advanced team stats (per-game values from `team_stats.league_values(game_id=...)`), biggest
win-probability swings, scoring plays and player lines from `player_weeks`; numbers open their
plays. Unplayed games get a preview: each offense against the other defense by league rank
(`MATCHUPS`), edge to the better rank, side-by-side ranks, form, past meetings, team leaders and
injuries; before any final regular-season game it falls back to last season and says so.
Phase 3 is complete. Next: Phase 2, the MCP connector.

## Frontend (web/)
- Stack (same as WePlan): React 19, react-router 8, TanStack Query 5, Tailwind v4, Vite,
  served by Caddy.
- Design language: "team-adaptive", approved by Michael on 2026-11-16 (mockups:
  https://claude.ai/artifact/1mwEbAuoXfbEkzuW65ov9x). It deliberately does NOT follow
  WePlan's look. Dark only, modern and flashy, built to show the same data several ways.
  - Every screen wears its team's colours: call `useScreenTeam(abbr)` (lib/palette.ts),
    which sets `--tp` (primary), `--tb` (glow-safe bright), `--ts` (second), `--td`
    (near-black tint). Screens with no team (Home, search) pass null for the ember
    league accent. Components use only these variables; team data lives in lib/teams.ts.
  - Negative values are white diagonal stripes (`.neg-stripes`), never a hue.
  - Type: Barlow Condensed italic caps (`.disp`, `.num`) + Inter. Surfaces: `.panel`
    glass, `HeroFrame` (spinning border, stripes, outlined watermark, light sweep).
  - Every data panel offers more than one view via `Segmented` / `ChipRow`
    (bars/line/table, cards/compact, ranked/bars, completion %/EPA/attempts).
  - Long option lists (stats, teams, seasons in filters) use `Select`, a styled native
    select (phones get their own picker). `ChipRow` scrolls sideways with faded edges,
    mouse-wheel support and arrow buttons on mouse devices; keep it for short lists.
  - Motion: `rise`, `grow-up`, `ring-in`, count-up (`useCountUp`); all honour
    prefers-reduced-motion.
- TypeScript types in `web/src/lib/api.ts` mirror `api/models.py`; change both together.
- Team logos: ingest caches them (`logos.py`, ESPN CDN links from the nflverse teams
  file, PNG-checked, size-capped) into `data/logos/`; the API serves
  `/api/teams/{ABBR}/logo`; `TeamMark` shows them and falls back to the two-tone disc.
  Logos are NFL trademarks: private, personal use only.
- Charts are hand-written SVG (`SeasonChart`, `QbPanels`, rings); no chart library.
- Copy: plain, sentence case, active voice; errors say what happened and what to do.
- Check: `cd web && npm run build` (typecheck + build). Never run bare `tsc`/`tsc -b`:
  it writes .js files next to the sources and Vite will serve those stale copies.

## Architecture rules
- `ingest` is the ONLY writer. It builds `nfl.duckdb.building`, validates, then
  atomically replaces `nfl.duckdb`. Every other service opens the DB read-only and
  should reopen it when the file changes (check mtime per request or on a timer).
- Downstream code queries VIEWS (`plays`, `dropbacks`, `targets`, `games`, `players`,
  `player_weeks`, `teams`, `team_games`, `team_weeks`), never `raw_*` tables.
  `team_games` has each game once per team (team_line: negative = favoured);
  `team_weeks` has per-game offense and defense totals over scrimmage plays.
- Divisions and conferences apply from 2002 (realignment); earlier seasons show
  league tables only.
- Metric logic lives ONLY in `sql/metrics.sql` (`metric_definitions`) and is executed
  ONLY through `nfl_analytics.metrics` (`compute_metric`, `metric_leaderboard`,
  `metric_plays`, `metric_by_week`). Add a metric there, not in an endpoint. Aggregates
  must be `count(*)` or `avg(<column>)`; metrics reading FTN fields get the credit
  automatically (`metrics.FTN_FIELDS`).
- New box-score stats need a play rule in `api/stats.py`; re-run the box-score comparison
  before shipping a rule change. New team stats go in `api/team_stats.py` only.
- User input is always a bound parameter. Never format user values into SQL.
- SQL files separate statements with a line containing only `-- ;;`.
- Freshness: ingest checks nflverse on `NFL_CHECK_CRONS` (default every 15 min on game
  days, hourly otherwise) and rebuilds only when a file changed (`pipeline.run`; busy checks
  skip without touching status.json). Live scores come from ESPN's scoreboard in
  `api/live.py` (in memory, like news; adaptive polling; stale after 10 min; nflverse finals
  always win; matched on teams + Eastern date; ESPN codes WSH/LAR map to WAS/LA) and are
  overlaid on `GET /api/games` as `Game.live`. The home page polls every 30 s while a game
  is on (`useWeek`).

## Conventions
- Python 3.12, type hints everywhere, `mypy --strict` clean, ruff lint + format.
- Tests use the synthetic cache in `tests/conftest.py`; extend it when adding views.
  Each rule in a metric gets a case that counts and a case that does not.
- Before committing: `ruff check src tests && ruff format --check src tests && mypy src && pytest`.
- Work on a branch and open a PR; CI must be green.

## Data facts worth knowing
- nflverse releases: https://github.com/nflverse/nflverse-data/releases (file names in
  `src/nfl_analytics/datasets.py`, verified 2026-11-16).
- FTN charting starts 2022; snap counts 2012; injuries 2009; Next Gen Stats 2016
  (single all-seasons files where week 0 = season totals).
- Snap counts key players by PFR ID; map through `raw_players.pfr_id`.
- No per-play "pressure" or separation in the free data.
- FTN is CC-BY-SA 4.0: credit "FTN Data via nflverse" anywhere it is shown.
