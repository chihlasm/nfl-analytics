# NFL Analytics

*Working name. A real name comes before launch.*

A self-hosted NFL analytics platform for the homelab. It downloads every free
nflverse dataset (play-by-play back to 1999, FTN charting, Next Gen Stats,
rosters, snaps, injuries, schedules) into one DuckDB database, refreshes it
automatically, and serves it to a dashboard (and soon to Claude through an MCP
server).

| Phase | What | Status |
| --- | --- | --- |
| 1 | Data foundation: ingest job, database, views, saved metrics | Done |
| 3a | Dashboard: league-wide home (scores, headlines, leaders, injuries), player search and player pages | **This release** |
| 2 | MCP server so Claude can answer questions from the data | Next |
| 3b | Team pages and the play Explorer (tap any stat to see its plays) | Planned |
| 4 | Compare, saved views, fantasy and betting views | Planned |

## How it works

```
nflverse GitHub releases ──► ingest (daily 6:00 ET, full Wed 6:30 ET)
                                │  downloads only changed files (ETag cache)
                                ▼
                        nfl.duckdb.building ──validate──► nfl.duckdb (atomic swap)
                                                            │ read-only mount
                                                            ▼
NFL news RSS feeds ──(every 15 min)──────────────────────► api (FastAPI) ◄── web (Caddy + React)
                                                                               ▲
                                              homelab Caddy, nfl.chihlas.com ──┘ (Tailscale only)
```

- **ingest** is the only thing that writes the database.
- **api** opens it read-only (the data folder is even mounted read-only) and
  reconnects automatically after each morning's swap. It also keeps the latest NFL
  headlines in memory: headline, source, time and link only, never article text.
- **web** serves the dashboard and forwards `/api` to the API. It joins the homelab
  reverse-proxy network, so the homelab Caddy can reach it as `nfl-web:8080`.
- Scores and stats refresh once a day, early each morning, not live during games.

- **Daily refresh:** re-checks current-season files and the all-seasons files,
  plus anything never downloaded. Unchanged files cost one tiny request.
- **Weekly full refresh (Wednesday):** re-checks every season to pick up nflverse
  corrections to old data.
- **Every run rebuilds the database from scratch** into a new file, validates it,
  then swaps it in atomically. A failed run never touches the live database. The
  previous database is kept as `nfl.duckdb.prev`.
- **Health:** each run writes `status.json`. The container turns unhealthy if no
  run has succeeded in 30 hours, which Uptime Kuma or Beszel can alert on.

Full build on real data: ~1.3 million plays, about 35 seconds and 3.6 GB peak
memory. Disk: about 520 MB of cached Parquet plus about 760 MB for the database.

## Deploy on docker-01

1. **Clone** onto docker-01 (or point Dockge at the repo):
   ```bash
   cd /opt/docker
   git clone https://github.com/chihlasm/nfl-analytics.git
   cd nfl-analytics
   ```
2. **Configure** (optional, every value has a default):
   ```bash
   cp .env.example .env
   # Set NFL_DATA_HOST_DIR to a tank dataset if you want the data off the VM disk,
   # e.g. NFL_DATA_HOST_DIR=/mnt/tank/nfl-analytics
   ```
   The data folder must be writable by the container user (`PUID`/`PGID`, default 1000).
3. **Create the data folder yourself** before the first start. If Docker creates it,
   it is owned by root and the container cannot write to it:
   ```bash
   mkdir -p data          # or your NFL_DATA_HOST_DIR
   sudo chown -R 1000:1000 data
   ```
   If you skip this, the container stops at startup with a message that gives the
   exact `chown` command to run.
4. **Start:**
   ```bash
   docker compose up -d --build
   docker compose logs -f ingest
   ```
   The first start downloads every season (about 520 MB) and builds the database,
   which takes a few minutes. After that it waits for the next scheduled run.
5. **Check it:**
   ```bash
   docker compose exec ingest nfl status
   docker compose exec ingest nfl metric short_throw_misses \
       --player "Michael Penix Jr." --season 2026 --week-to 9
   docker compose exec web wget -qO- http://api:8000/api/meta   # API answering?
   ```
6. **Publish the dashboard at nfl.chihlas.com (Tailscale only).** The `web` container
   joins the homelab Caddy's Docker network (`docker_homelab` by default; set
   `HOMELAB_NETWORK` in `.env` if yours is named differently). Add a site to the
   homelab Caddyfile, matching how your other internal sites are set up. A starting
   point that only answers Tailscale addresses:
   ```caddy
   nfl.chihlas.com {
       @tailnet remote_ip 100.64.0.0/10 fd7a:115c:a1e0::/48
       handle @tailnet {
           reverse_proxy nfl-web:8080
       }
       respond "Not available" 403
   }
   ```
   Then reload Caddy, and point `nfl.chihlas.com` at docker-01's Tailscale address in
   DNS if your wildcard record doesn't already cover it.
7. **Check the news feeds** once it's running:
   ```bash
   docker compose exec web wget -qO- http://api:8000/api/news | head -c 400
   ```
   `sources_failed` lists any feed that didn't load. Feeds are set with
   `NFL_NEWS_FEEDS` in `.env` as `Name|URL` pairs separated by commas. The defaults
   are ESPN, CBS Sports, Yahoo Sports and Pro Football Talk.

### Updating

```bash
cd /opt/docker/nfl-analytics
git pull
docker compose up -d --build
```

If a release changes the database views, the ingest container rebuilds the database
from its cache on startup (about a minute, no downloads), and the API switches over
automatically.

## Command reference

Run inside the container (`docker compose exec ingest nfl ...`) or locally after
`pip install -e ".[dev]"` with `NFL_DATA_DIR` set.

| Command | What it does |
| --- | --- |
| `nfl refresh` | Download what changed (daily mode) and rebuild once |
| `nfl refresh --full` | Re-check every season, then rebuild |
| `nfl build` | Rebuild from the local cache only, no downloads |
| `nfl schedule` | Run forever on the daily and weekly schedules (container default) |
| `nfl status` | Show the last run: files, rows, latest week, errors |
| `nfl health` | Exit 0 if the last success is under 30 hours old |
| `nfl metric NAME --player P --season S` | Compute a saved metric (`--week-from`, `--week-to`, `--season-type REG\|POST\|ALL`) |
| `nfl query "SQL"` | Run a read-only query and print the result |

## The data

**Raw tables** mirror the nflverse files: `raw_pbp`, `raw_ftn`, `raw_player_week`,
`raw_rosters`, `raw_snap_counts`, `raw_injuries`, `raw_players`, `raw_schedules`,
`raw_ngs_passing`, `raw_ngs_receiving`, `raw_ngs_rushing`.

**Views** are what everything else queries (defined in
[`src/nfl_analytics/sql/views.sql`](src/nfl_analytics/sql/views.sql)):

| View | One row per | Notes |
| --- | --- | --- |
| `plays` | Play | Play-by-play + FTN charting (2022 on); adds `is_charted`, `is_short_pass`, `depth_bucket`, `is_blitz` |
| `dropbacks` | QB dropback | Adds `is_pass_attempt`, `is_inaccurate_incompletion`, `is_short_throw_miss` |
| `targets` | Targeted pass | Passes thrown to a receiver |
| `games` | Game | Scores, lines, weather, starting QBs |
| `players` | Player | Keyed by GSIS `player_id` |
| `player_weeks` | Player × week | Box score + snaps + injury report + weekly Next Gen Stats |

**Saved metrics** live in the `metric_definitions` table
([`sql/metrics.sql`](src/nfl_analytics/sql/metrics.sql)) so every surface counts
the same way: `short_throw_misses`, `short_throw_miss_rate`,
`inaccurate_incompletions`, `catchable_ball_rate`, `receiver_drops`,
`epa_per_dropback`.

**Freshness:** nflverse play-by-play updates within about a day of each game. FTN
charting lands within 48 hours, so accuracy metrics for the latest week fill in
a day or two after play-by-play does.

**Not in the free data:** a "pressured" flag and receiver separation per play.
Pressure is approximated with `qb_hit` and `is_blitz`; separation is available
only as weekly Next Gen Stats averages.

## Development

```bash
pip install -e ".[dev]"
uvicorn --factory nfl_analytics.api.app:app --reload   # API on :8000 (needs NFL_DATA_DIR)
cd web && npm install && npm run dev                     # dashboard on :5173, proxies /api
pytest                 # unit tests on a synthetic fixture (seconds)
pytest -m network      # Phase 1 gate on real data (downloads ~500 MB)
ruff check src tests && ruff format --check src tests && mypy src
```

The Phase 1 gate: Michael Penix Jr. had **27** short-throw misses in 2026 Weeks
1-9. An earlier hand count of 28 wrongly included a Week 7 spike to stop the
clock; the pipeline correctly excludes spikes.

## Credits and licensing

Data from the [nflverse](https://github.com/nflverse) project. FTN charting data is
CC-BY-SA 4.0: **"FTN Data via nflverse."** This platform is private and for
personal analysis only.

## Team logos

The ingest job downloads the 32 team logos into `data/logos/` (missing ones daily, all of them re-checked weekly) and the dashboard loads them from its own API, so viewers' browsers never contact a third party. If a logo is missing, the team's two-colour disc shows instead. Logos are NFL trademarks; this project is private and for personal use only.
