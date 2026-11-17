import { ArrowDown, ArrowUp, RotateCcw } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";

import { QueryState } from "../components/Notice";
import { TeamLink, TeamMark } from "../components/TeamMark";
import { ChipRow, Panel, Segmented, Select, type Option } from "../components/ui";
import type { ExplorerOrder, ExplorerRow, ExplorerSort, SeasonType, StatInfo } from "../lib/api";
import { num } from "../lib/format";
import { alpha, useScreenTeam } from "../lib/palette";
import { useExplorer, useStatCatalog, type ExplorerFilters } from "../lib/queries";
import { statGroups } from "../lib/stats";
import { TEAMS, team } from "../lib/teams";

/* ------------------------------------------------------------ url state */

const DEFAULT_STAT = "passing_yards";
const SEASON_TYPES: readonly Option<SeasonType>[] = [
  { key: "REG", label: "Regular season" },
  { key: "POST", label: "Playoffs" },
  { key: "ALL", label: "Both" },
];
const SORTS: readonly Option<ExplorerSort>[] = [
  { key: "total", label: "Total" },
  { key: "per_game", label: "Per game" },
];
const ORDERS: readonly Option<ExplorerOrder>[] = [
  { key: "desc", label: "Highest" },
  { key: "asc", label: "Lowest" },
];
const MIN_GAMES = [0, 2, 4, 6, 8, 10, 12] as const;
const TEAM_OPTIONS: Option<string>[] = [
  { key: "", label: "All teams" },
  ...Object.entries(TEAMS)
    .map(([abbr, t]) => ({ key: abbr, label: t.name }))
    .sort((a, b) => a.label.localeCompare(b.label)),
];

function pick<K extends string>(value: string | null, options: readonly Option<K>[], fallback: K): K {
  return options.some((o) => o.key === value) ? (value as K) : fallback;
}

/** Read filters from the address bar, ignoring anything malformed. */
function readFilters(params: URLSearchParams): Required<Pick<ExplorerFilters, "stat" | "season_type" | "sort" | "order" | "min_games">> &
  ExplorerFilters {
  const season = Number(params.get("season"));
  const minGames = Number(params.get("min_games"));
  const teamParam = params.get("team")?.toUpperCase();
  return {
    stat: params.get("stat") || DEFAULT_STAT,
    season: Number.isInteger(season) && season > 1990 ? season : undefined,
    season_type: pick(params.get("season_type"), SEASON_TYPES, "REG"),
    position: params.get("position") || undefined,
    team: teamParam && TEAMS[teamParam] ? teamParam : undefined,
    min_games: (MIN_GAMES as readonly number[]).includes(minGames) ? minGames : 0,
    sort: pick(params.get("sort"), SORTS, "total"),
    order: pick(params.get("order"), ORDERS, "desc"),
  };
}

const DEFAULTS: Record<string, string> = { season_type: "REG", sort: "total", order: "desc", min_games: "0" };

/* --------------------------------------------------------------- screen */

export function Explorer() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => readFilters(params), [params]);
  useScreenTeam(filters.team ?? null);

  const catalog = useStatCatalog();
  const query = useExplorer(filters);
  const pages = query.data?.pages ?? [];
  const first = pages[0];
  const rows = pages.flatMap((p) => p.rows);
  const stat = first?.stat ?? catalog.data?.stats.find((s) => s.key === filters.stat);

  const set = (key: string, value: string | undefined) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === undefined || value === "" || DEFAULTS[key] === value) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  const filtered = Boolean(filters.position || filters.team || filters.min_games || filters.season_type !== "REG" || filters.order !== "desc" || filters.sort !== "total");
  const reset = () =>
    setParams(
      (prev) => {
        const next = new URLSearchParams();
        for (const k of ["stat", "season"]) {
          const v = prev.get(k);
          if (v) next.set(k, v);
        }
        return next;
      },
      { replace: true },
    );

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="disp text-[3.5rem] leading-[0.86] sm:text-[4.5rem]">
          Stat <span className="text-[var(--tb)]">explorer</span>
        </h1>
        <p className="text-sm text-muted">Rank every player on any stat. Filter by season, team or position, then tap a player to open their page.</p>
      </header>

      <Panel delay={0.04}>
        <div className="flex flex-col gap-3">
          {/* Phones: stat and team full width, season and games side by side. */}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {catalog.data && (
              <Select
                value={filters.stat}
                onChange={(v) => set("stat", v)}
                label="Stat"
                prefix="Stat"
                groups={statGroups(catalog.data.stats)}
                className="col-span-2 sm:w-80"
              />
            )}
            <Select
              value={filters.team ?? ""}
              onChange={(v) => set("team", v || undefined)}
              label="Team"
              prefix="Team"
              options={TEAM_OPTIONS}
              className="col-span-2 sm:w-72"
            />
            <Select
              value={String(first?.season ?? filters.season ?? "")}
              onChange={(v) => set("season", v)}
              label="Season"
              prefix="Season"
              options={(first?.seasons ?? (filters.season ? [filters.season] : [])).map((s) => ({ key: String(s), label: String(s) }))}
              className="sm:w-44"
            />
            <Select
              value={String(filters.min_games)}
              onChange={(v) => set("min_games", v)}
              label="Minimum games played"
              prefix="Games"
              options={MIN_GAMES.map((g) => ({ key: String(g), label: g ? `${g} or more` : "Any" }))}
              className="sm:w-48"
            />
          </div>
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <ChipRow
              options={[{ key: "", label: "All positions" }, ...(catalog.data?.position_groups ?? []).map((g) => ({ key: g, label: g }))]}
              value={filters.position ?? ""}
              onChange={(v) => set("position", v || undefined)}
              label="Position"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Segmented options={SEASON_TYPES} value={filters.season_type} onChange={(v) => set("season_type", v)} label="Season type" />
              {filtered && (
                <button type="button" onClick={reset} className="pill">
                  <RotateCcw size={15} aria-hidden="true" />
                  Reset filters
                </button>
              )}
            </div>
          </div>
        </div>
      </Panel>

      <Results
        stat={stat}
        rows={rows}
        total={first?.total ?? 0}
        season={first?.season}
        throughWeek={first?.through_week ?? null}
        filters={filters}
        onSort={(v) => set("sort", v)}
        onOrder={(v) => set("order", v)}
        isPending={query.isPending}
        error={query.error}
        dimmed={query.isPlaceholderData}
        more={
          query.hasNextPage ? (
            <button
              type="button"
              className="pill mx-auto min-h-12 px-6"
              onClick={() => void query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
            >
              {query.isFetchingNextPage ? "Loading…" : `Show more (${rows.length} of ${first?.total ?? 0})`}
            </button>
          ) : null
        }
      />
    </div>
  );
}

/* -------------------------------------------------------------- results */

type View = "table" | "bars" | "cards";
const VIEWS: readonly Option<View>[] = [
  { key: "table", label: "Table" },
  { key: "bars", label: "Bars" },
  { key: "cards", label: "Cards" },
];

function seasonText(t: SeasonType): string {
  return t === "REG" ? "regular season" : t === "POST" ? "playoffs" : "regular season and playoffs";
}

function Results({
  stat,
  rows,
  total,
  season,
  throughWeek,
  filters,
  onSort,
  onOrder,
  isPending,
  error,
  dimmed,
  more,
}: {
  stat: StatInfo | undefined;
  rows: ExplorerRow[];
  total: number;
  season: number | undefined;
  throughWeek: number | null;
  filters: ReturnType<typeof readFilters>;
  onSort: (s: ExplorerSort) => void;
  onOrder: (o: ExplorerOrder) => void;
  isPending: boolean;
  error: unknown;
  dimmed: boolean;
  more: ReactNode;
}) {
  const [view, setView] = useState<View>("table");
  const decimals = stat?.decimals ?? 0;
  const metric = (r: ExplorerRow) => (filters.sort === "per_game" ? r.per_game : r.value);
  const max = Math.max(1e-9, ...rows.map((r) => Math.abs(metric(r))));
  const bits = [
    season && `${season} ${seasonText(filters.season_type)}`,
    filters.season_type === "REG" && throughWeek ? `through week ${throughWeek}` : null,
    filters.team && team(filters.team)?.name,
    filters.position,
    filters.min_games ? `${filters.min_games}+ games` : null,
  ].filter(Boolean);

  return (
    <Panel
      title={stat?.label ?? "Results"}
      subtitle={`${total} ${total === 1 ? "player" : "players"}${bits.length ? ` · ${bits.join(" · ")}` : ""}`}
      delay={0.08}
      actions={<Segmented options={VIEWS} value={view} onChange={setView} label="Results view" />}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Segmented options={SORTS} value={filters.sort} onChange={onSort} label="Rank by" />
        <Segmented options={ORDERS} value={filters.order} onChange={onOrder} label="Order" />
      </div>
      <QueryState isPending={isPending} error={error} empty={rows.length === 0} emptyText="No players match these filters. Try another season or fewer filters." rows={6}>
        <div className={`flex flex-col gap-4 transition-opacity ${dimmed ? "opacity-60" : ""}`}>
          {view === "table" && <ResultsTable rows={rows} decimals={decimals} sort={filters.sort} order={filters.order} season={season} onSort={onSort} onOrder={onOrder} />}
          {view === "bars" && <ResultsBars rows={rows} decimals={decimals} metric={metric} max={max} perGame={filters.sort === "per_game"} />}
          {view === "cards" && <ResultsCards rows={rows} decimals={decimals} perGame={filters.sort === "per_game"} />}
          {more}
        </div>
      </QueryState>
    </Panel>
  );
}

function SortHeader({
  label,
  column,
  sort,
  order,
  onSort,
  onOrder,
}: {
  label: string;
  column: ExplorerSort;
  sort: ExplorerSort;
  order: ExplorerOrder;
  onSort: (s: ExplorerSort) => void;
  onOrder: (o: ExplorerOrder) => void;
}) {
  const active = sort === column;
  const Arrow = order === "desc" ? ArrowDown : ArrowUp;
  return (
    <th scope="col" aria-sort={active ? (order === "desc" ? "descending" : "ascending") : "none"}>
      <button
        type="button"
        className={`inline-flex items-center gap-1 ${active ? "text-[var(--tb)]" : "hover:text-white"}`}
        onClick={() => (active ? onOrder(order === "desc" ? "asc" : "desc") : onSort(column))}
      >
        {label}
        {active && <Arrow size={13} aria-hidden="true" />}
      </button>
    </th>
  );
}

function ResultsTable({
  rows,
  decimals,
  sort,
  order,
  season,
  onSort,
  onOrder,
}: {
  rows: ExplorerRow[];
  decimals: number;
  sort: ExplorerSort;
  order: ExplorerOrder;
  season: number | undefined;
  onSort: (s: ExplorerSort) => void;
  onOrder: (o: ExplorerOrder) => void;
}) {
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col" className="!text-left">
              Player
            </th>
            <th scope="col" className="!text-left">
              Team
            </th>
            <th scope="col">Games</th>
            <SortHeader label="Total" column="total" sort={sort} order={order} onSort={onSort} onOrder={onOrder} />
            <SortHeader label="Per game" column="per_game" sort={sort} order={order} onSort={onSort} onOrder={onOrder} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.player_id}>
              <td className="num text-[1.05rem] text-muted">{r.rank}</td>
              <td className="!text-left">
                <Link to={`/players/${r.player_id}${season ? `?season=${season}` : ""}`} className="font-bold hover:underline hover:underline-offset-4">
                  {r.name}
                </Link>
                {r.position && <span className="ml-2 text-xs text-muted">{r.position}</span>}
              </td>
              <td className="!text-left">
                {r.team && (
                  <TeamLink abbr={r.team} season={season} className="inline-flex items-center gap-1.5 font-semibold">
                    <TeamMark abbr={r.team} size={11} />
                    {r.team}
                  </TeamLink>
                )}
              </td>
              <td>{r.games}</td>
              <td className={sort === "total" ? "font-bold text-white" : ""}>{num(r.value, decimals)}</td>
              <td className={sort === "per_game" ? "font-bold text-white" : ""}>{num(r.per_game, Math.max(1, decimals))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultsBars({
  rows,
  decimals,
  metric,
  max,
  perGame,
}: {
  rows: ExplorerRow[];
  decimals: number;
  metric: (r: ExplorerRow) => number;
  max: number;
  perGame: boolean;
}) {
  return (
    <ol className="flex flex-col gap-3">
      {rows.map((r, i) => {
        const v = metric(r);
        const t = team(r.team);
        return (
          <li key={r.player_id}>
            <Link to={`/players/${r.player_id}`} className="group flex flex-col gap-1.5">
              <span className="flex items-baseline justify-between gap-3 text-sm font-semibold">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="num w-8 shrink-0 text-right text-[1.05rem] text-faint">{r.rank}</span>
                  <TeamMark abbr={r.team} size={11} />
                  <span className="truncate group-hover:underline group-hover:underline-offset-4">{r.name}</span>
                  <span className="shrink-0 text-xs text-faint">{r.position}</span>
                </span>
                <span className="num shrink-0 text-[1.4rem] leading-none">{num(v, perGame ? Math.max(1, decimals) : decimals)}</span>
              </span>
              <span className="ml-10 block h-3 overflow-hidden rounded-md bg-white/[0.06]" aria-hidden="true">
                <span
                  className={`grow-right block h-full rounded-md ${v < 0 ? "neg-stripes" : ""}`}
                  style={{
                    width: `${Math.max(2, (Math.abs(v) / max) * 100)}%`,
                    animationDelay: `${Math.min(i, 20) * 0.025}s`,
                    ...(v < 0
                      ? {}
                      : {
                          background: `linear-gradient(90deg, ${t?.primary ?? "#374151"}, ${t?.bright ?? "#9ca3af"})`,
                          boxShadow: i < 3 ? `0 0 14px -2px ${alpha(t?.bright ?? "#9ca3af", 0.8)}` : undefined,
                        }),
                  }}
                />
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

function ResultsCards({ rows, decimals, perGame }: { rows: ExplorerRow[]; decimals: number; perGame: boolean }) {
  return (
    <ol className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
      {rows.map((r) => {
        const t = team(r.team);
        const b = t?.bright ?? "#9ca3af";
        const podium = r.rank <= 3;
        return (
          <li key={r.player_id}>
            <Link
              to={`/players/${r.player_id}`}
              className="relative flex h-full flex-col gap-2 overflow-hidden rounded-[16px] p-3.5 transition-transform hover:-translate-y-0.5"
              style={{
                background: podium ? `linear-gradient(150deg, ${alpha(t?.primary ?? "#374151", 0.75)}, #0b0b0c 70%)` : "#0b0b0c",
                border: `1px solid ${podium ? alpha(b, 0.6) : "rgba(255,255,255,0.08)"}`,
                boxShadow: podium ? `0 0 28px -10px ${alpha(b, 0.9)}` : undefined,
              }}
            >
              <span className="flex items-center justify-between">
                <span className="num text-[1.6rem] leading-none" style={{ color: podium ? b : "#4b5563" }}>
                  {r.rank}
                </span>
                <TeamMark abbr={r.team} size={16} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-bold text-white">{r.name}</span>
                <span className="text-xs text-muted">
                  {[r.position, r.team, `${r.games} games`].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="mt-auto flex items-baseline gap-2">
                <span className="num text-[2rem] leading-none text-white">{num(perGame ? r.per_game : r.value, perGame ? Math.max(1, decimals) : decimals)}</span>
                <span className="text-xs text-muted">
                  {perGame ? `${num(r.value, decimals)} total` : `${num(r.per_game, Math.max(1, decimals))} a game`}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
