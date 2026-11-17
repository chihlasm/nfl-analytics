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
Next in 3b: Explorer.

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
  - Motion: `rise`, `grow-up`, `ring-in`, count-up (`useCountUp`); all honour
    prefers-reduced-motion.
- TypeScript types in `web/src/lib/api.ts` mirror `api/models.py`; change both together.
- Team logos: ingest caches them (`logos.py`, ESPN CDN links from the nflverse teams
  file, PNG-checked, size-capped) into `data/logos/`; the API serves
  `/api/teams/{ABBR}/logo`; `TeamMark` shows them and falls back to the two-tone disc.
  Logos are NFL trademarks: private, personal use only.
- Charts are hand-written SVG (`SeasonChart`, `QbPanels`, rings); no chart library.
- Copy: plain, sentence case, active voice; errors say what happened and what to do.
- Check: `cd web && npm run build` (typecheck + build).

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
  ONLY through `nfl_analytics.metrics`. Add a metric there, not in an endpoint.
- User input is always a bound parameter. Never format user values into SQL.
- SQL files separate statements with a line containing only `-- ;;`.

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
