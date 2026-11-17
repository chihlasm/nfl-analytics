import { ArrowDown, ArrowUp, RotateCcw } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";

import { QueryState } from "../components/Notice";
import { StatTap } from "../components/StatTap";
import { TeamLink, TeamMark } from "../components/TeamMark";
import { ChipRow, Panel, Segmented, Select, type Option } from "../components/ui";
import type { ExplorerOrder, ExplorerRow, ExplorerSort, SeasonType, StatInfo, TeamExplorer, TeamExplorerRow } from "../lib/api";
import type { PlaysTarget } from "../lib/plays";
import { alpha, useScreenTeam } from "../lib/palette";
import { useExplorer, useStatCatalog, useTeamExplorer, type ExplorerFilters, type TeamExplorerFilters } from "../lib/queries";
import { statGroups, statValue } from "../lib/stats";
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
/** Qualifier choices for rates and averages (the API defaults to 50 plays). */
const MIN_PLAYS = [1, 25, 50, 100, 200, 300] as const;
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
  const minPlays = Number(params.get("min_plays"));
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
    min_plays: (MIN_PLAYS as readonly number[]).includes(minPlays) ? minPlays : undefined,
  };
}

const DEFAULTS: Record<string, string> = { season_type: "REG", sort: "total", order: "desc", min_games: "0" };

/* --------------------------------------------------------------- screen */

type Subject = "players" | "teams";
const SUBJECTS: readonly Option<Subject>[] = [
  { key: "players", label: "Players" },
  { key: "teams", label: "Teams" },
];

export function Explorer() {
  const [params, setParams] = useSearchParams();
  const subject: Subject = params.get("subject") === "teams" ? "teams" : "players";
  // Switching subject starts fresh: player and team filters don't mean the same thing.
  const switchTo = (next: Subject) =>
    setParams(() => {
      const kept = new URLSearchParams();
      const season = params.get("season");
      if (season) kept.set("season", season);
      if (next === "teams") kept.set("subject", "teams");
      return kept;
    });

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="disp text-[3.5rem] leading-[0.86] sm:text-[4.5rem]">
            Stat <span className="text-[var(--tb)]">explorer</span>
          </h1>
          <p className="text-sm text-muted">
            {subject === "players"
              ? "Rank every player on any stat. Filter by season, team or position, then tap a number to see its plays."
              : "Rank all 32 teams on any team stat, offense or defense. Tap a number to see its plays."}
          </p>
        </div>
        <Segmented options={SUBJECTS} value={subject} onChange={switchTo} label="Rank players or teams" />
      </header>
      {subject === "players" ? <PlayerExplorer /> : <TeamExplorerView />}
    </div>
  );
}

function PlayerExplorer() {
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
  const filtered = Boolean(
    filters.position || filters.team || filters.min_games || filters.min_plays || filters.season_type !== "REG" || filters.order !== "desc" || filters.sort !== "total",
  );
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
    <>
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
            {stat?.kind === "metric" && stat.unit !== "count" && (
              <Select
                value={String(first?.min_plays ?? filters.min_plays ?? 50)}
                onChange={(v) => set("min_plays", v === "50" ? undefined : v)}
                label="Minimum qualifying plays"
                prefix="Plays"
                options={MIN_PLAYS.map((n) => ({ key: String(n), label: n === 1 ? "Any" : `${n} or more` }))}
                className="col-span-2 sm:w-48"
              />
            )}
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
        minPlays={first?.min_plays ?? 0}
        note={first?.note ?? null}
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
    </>
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

type Filters = ReturnType<typeof readFilters>;

/** Everything a results view needs to show and open a row's plays. */
interface Ctx {
  stat: StatInfo;
  season: number | undefined;
  filters: Filters;
  perGame: boolean;
}

function playsTarget(ctx: Ctx, r: ExplorerRow): PlaysTarget {
  return {
    player: r.player_id,
    stat: ctx.stat.key,
    season: ctx.season,
    season_type: ctx.filters.season_type,
    team: ctx.filters.team,
  };
}

function tapLabel(ctx: Ctx, r: ExplorerRow): string {
  return `${r.name}, ${ctx.stat.label}: see the plays`;
}

function Results({
  stat,
  rows,
  total,
  season,
  throughWeek,
  minPlays,
  note,
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
  minPlays: number;
  note: string | null;
  filters: Filters;
  onSort: (s: ExplorerSort) => void;
  onOrder: (o: ExplorerOrder) => void;
  isPending: boolean;
  error: unknown;
  dimmed: boolean;
  more: ReactNode;
}) {
  const [view, setView] = useState<View>("table");
  const perGame = Boolean(stat?.per_game) && filters.sort === "per_game";
  const ctx: Ctx | null = stat ? { stat, season, filters, perGame } : null;
  const bits = [
    season && `${season} ${seasonText(filters.season_type)}`,
    filters.season_type === "REG" && throughWeek ? `through week ${throughWeek}` : null,
    filters.team && team(filters.team)?.name,
    filters.position,
    filters.min_games ? `${filters.min_games}+ games` : null,
    minPlays > 1 ? `at least ${minPlays} plays` : null,
  ].filter(Boolean);

  return (
    <Panel
      title={stat?.label ?? "Results"}
      subtitle={`${total} ${total === 1 ? "player" : "players"}${bits.length ? ` · ${bits.join(" · ")}` : ""}`}
      delay={0.08}
      actions={<Segmented options={VIEWS} value={view} onChange={setView} label="Results view" />}
    >
      {stat?.description && <p className="-mt-2 max-w-3xl text-sm text-gray-300">{stat.description}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {stat?.per_game !== false && <Segmented options={SORTS} value={filters.sort} onChange={onSort} label="Rank by" />}
        <Segmented options={ORDERS} value={filters.order} onChange={onOrder} label="Order" />
        <span className="text-xs text-muted">Tap a number to see the plays behind it.</span>
      </div>
      <QueryState
        isPending={isPending}
        error={error}
        empty={rows.length === 0}
        emptyText={note ?? "No players match these filters. Try another season or fewer filters."}
        rows={6}
      >
        {ctx && (
          <div className={`flex flex-col gap-4 transition-opacity ${dimmed ? "opacity-60" : ""}`}>
            {view === "table" && <ResultsTable rows={rows} ctx={ctx} onSort={onSort} onOrder={onOrder} />}
            {view === "bars" && <ResultsBars rows={rows} ctx={ctx} />}
            {view === "cards" && <ResultsCards rows={rows} ctx={ctx} />}
            {more}
          </div>
        )}
      </QueryState>
      {stat?.credit && <p className="text-xs text-faint">Charting: {stat.credit} (CC-BY-SA 4.0).</p>}
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
  ctx,
  onSort,
  onOrder,
}: {
  rows: ExplorerRow[];
  ctx: Ctx;
  onSort: (s: ExplorerSort) => void;
  onOrder: (o: ExplorerOrder) => void;
}) {
  const { stat, season, filters } = ctx;
  const showAttempts = rows.some((r) => r.attempts != null);
  const valueLabel = stat.unit === "rate" ? "Rate" : stat.unit === "epa" && stat.kind === "metric" ? "Average" : "Total";
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
            {showAttempts && <th scope="col">Plays</th>}
            <SortHeader label={valueLabel} column="total" sort={filters.sort} order={filters.order} onSort={onSort} onOrder={onOrder} />
            {stat.per_game && <SortHeader label="Per game" column="per_game" sort={filters.sort} order={filters.order} onSort={onSort} onOrder={onOrder} />}
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
              {showAttempts && <td className="text-muted">{r.attempts ?? "–"}</td>}
              <td className={filters.sort === "total" ? "font-bold text-white" : ""}>
                <StatTap target={playsTarget(ctx, r)} label={tapLabel(ctx, r)}>
                  {statValue(stat, r.value)}
                </StatTap>
              </td>
              {stat.per_game && (
                <td className={filters.sort === "per_game" ? "font-bold text-white" : ""}>
                  <StatTap target={playsTarget(ctx, r)} label={tapLabel(ctx, r)}>
                    {statValue(stat, r.per_game, true)}
                  </StatTap>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function shown(ctx: Ctx, r: ExplorerRow): number {
  return ctx.perGame ? r.per_game : r.value;
}

function ResultsBars({ rows, ctx }: { rows: ExplorerRow[]; ctx: Ctx }) {
  const max = Math.max(1e-9, ...rows.map((r) => Math.abs(shown(ctx, r))));
  return (
    <ol className="flex flex-col gap-3">
      {rows.map((r, i) => {
        const v = shown(ctx, r);
        const t = team(r.team);
        return (
          <li key={r.player_id} className="flex flex-col gap-1.5">
            <span className="flex items-baseline justify-between gap-3 text-sm font-semibold">
              <span className="flex min-w-0 items-center gap-2">
                <span className="num w-8 shrink-0 text-right text-[1.05rem] text-faint">{r.rank}</span>
                <TeamMark abbr={r.team} size={11} />
                <Link to={`/players/${r.player_id}`} className="truncate hover:underline hover:underline-offset-4">
                  {r.name}
                </Link>
                <span className="shrink-0 text-xs text-faint">{r.position}</span>
              </span>
              <StatTap target={playsTarget(ctx, r)} label={tapLabel(ctx, r)} className="num shrink-0 text-[1.4rem] leading-none">
                {statValue(ctx.stat, v, ctx.perGame)}
              </StatTap>
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
          </li>
        );
      })}
    </ol>
  );
}

function ResultsCards({ rows, ctx }: { rows: ExplorerRow[]; ctx: Ctx }) {
  const { stat } = ctx;
  return (
    <ol className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
      {rows.map((r) => {
        const t = team(r.team);
        const b = t?.bright ?? "#9ca3af";
        const podium = r.rank <= 3;
        const secondary =
          stat.unit === "rate" || (stat.kind === "metric" && stat.unit === "epa")
            ? r.attempts != null
              ? `on ${r.attempts} plays`
              : null
            : ctx.perGame
              ? `${statValue(stat, r.value)} total`
              : `${statValue(stat, r.per_game, true)} a game`;
        return (
          <li
            key={r.player_id}
            className="relative flex h-full flex-col gap-2 overflow-hidden rounded-[16px] p-3.5"
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
              <Link to={`/players/${r.player_id}`} className="truncate font-bold text-white hover:underline hover:underline-offset-4">
                {r.name}
              </Link>
              <span className="text-xs text-muted">{[r.position, r.team, `${r.games} games`].filter(Boolean).join(" · ")}</span>
            </span>
            <span className="mt-auto flex flex-wrap items-baseline gap-x-2">
              <StatTap target={playsTarget(ctx, r)} label={tapLabel(ctx, r)} className="num text-[2rem] leading-none text-white">
                {statValue(stat, shown(ctx, r), ctx.perGame)}
              </StatTap>
              {secondary && <span className="text-xs text-muted">{secondary}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ----------------------------------------------------------------- teams */

const CONFERENCE_OPTIONS: readonly Option<"" | "AFC" | "NFC">[] = [
  { key: "", label: "All teams" },
  { key: "AFC", label: "AFC" },
  { key: "NFC", label: "NFC" },
];
const TEAM_ORDERS: readonly Option<"best" | "worst">[] = [
  { key: "best", label: "Best first" },
  { key: "worst", label: "Worst first" },
];
const DEFAULT_TEAM_STAT = "epa_per_play";

function TeamExplorerView() {
  useScreenTeam(null);
  const [params, setParams] = useSearchParams();
  const catalog = useStatCatalog();
  const season = Number(params.get("season"));
  const conference = params.get("conference");
  const filters: TeamExplorerFilters = {
    stat: params.get("stat") || DEFAULT_TEAM_STAT,
    season: Number.isInteger(season) && season > 1990 ? season : undefined,
    season_type: pick(params.get("season_type"), SEASON_TYPES, "REG"),
    conference: conference === "AFC" || conference === "NFC" ? conference : undefined,
    order: params.get("order") === "worst" ? "worst" : "best",
  };
  const query = useTeamExplorer(filters);
  const data = query.data;
  const [view, setView] = useState<View>("table");

  const set = (key: string, value: string | undefined) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        const fallback: Record<string, string> = { season_type: "REG", order: "best" };
        if (!value || fallback[key] === value) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );

  const stat = data?.stat;
  const bits = [
    data && `${data.season} ${seasonText(data.season_type)}`,
    data?.season_type === "REG" && data.through_week ? `through week ${data.through_week}` : null,
    data?.conference,
  ].filter(Boolean);

  return (
    <>
      <Panel delay={0.04}>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {catalog.data && (
            <Select
              value={filters.stat}
              onChange={(v) => set("stat", v)}
              label="Team stat"
              prefix="Stat"
              groups={statGroups(catalog.data.team_stats, ["offense", "defense"])}
              className="col-span-2 sm:w-96"
            />
          )}
          <Select
            value={String(data?.season ?? filters.season ?? "")}
            onChange={(v) => set("season", v)}
            label="Season"
            prefix="Season"
            options={(data?.seasons ?? (filters.season ? [filters.season] : [])).map((x) => ({ key: String(x), label: String(x) }))}
            className="sm:w-44"
          />
          <Select
            value={filters.conference ?? ""}
            onChange={(v) => set("conference", v || undefined)}
            label="Conference"
            options={CONFERENCE_OPTIONS}
            className="sm:w-56"
          />
        </div>
        <div className="self-start">
          <Segmented options={SEASON_TYPES} value={filters.season_type ?? "REG"} onChange={(v) => set("season_type", v)} label="Season type" />
        </div>
      </Panel>

      <Panel
        title={stat?.label ?? "Results"}
        subtitle={`${data?.rows.length ?? 0} teams${bits.length ? ` · ${bits.join(" · ")}` : ""}`}
        delay={0.08}
        actions={<Segmented options={VIEWS} value={view} onChange={setView} label="Results view" />}
      >
        {stat?.description && <p className="-mt-2 max-w-3xl text-sm text-gray-300">{stat.description}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Segmented options={TEAM_ORDERS} value={filters.order ?? "best"} onChange={(v) => set("order", v)} label="Order" />
          <span className="text-xs text-muted">
            {stat?.has_plays === false ? "Points come from final scores, so they have no plays list." : "Tap a number to see the plays behind it."}
          </span>
        </div>
        <QueryState isPending={query.isPending} error={query.error} empty={!data?.rows.length} emptyText="No games on record for that season." rows={8}>
          {data && stat && (
            <div className={`transition-opacity ${query.isPlaceholderData ? "opacity-60" : ""}`}>
              <TeamResults data={data} stat={stat} view={view} />
            </div>
          )}
        </QueryState>
        {data?.league_avg != null && stat && <p className="text-xs text-faint">League average: {statValue(stat, data.league_avg)}. Ranks are across the whole league.</p>}
      </Panel>
    </>
  );
}

function teamTarget(stat: StatInfo, data: TeamExplorer, abbr: string): PlaysTarget | null {
  if (!stat.has_plays) return null;
  return { subject: "team", team: abbr, stat: stat.key, season: data.season, season_type: data.season_type };
}

function TeamResults({ data, stat, view }: { data: TeamExplorer; stat: StatInfo; view: View }) {
  const values = data.rows.map((r) => r.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const avg = data.league_avg ?? 0;
  const label = (r: TeamExplorerRow) => `${r.name}, ${stat.label}: see the plays`;
  const signedScale = stat.unit === "epa"; // EPA bars grow from zero both ways

  if (view === "table") {
    return (
      <div className="-mx-4 overflow-x-auto sm:mx-0">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col" className="!text-left">
                Team
              </th>
              <th scope="col">{stat.short}</th>
              <th scope="col">vs average</th>
              <th scope="col">Games</th>
              {stat.has_plays && <th scope="col">Plays</th>}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const delta = r.value - avg;
              const good = stat.higher_is_better ? delta > 0 : delta < 0;
              return (
                <tr key={r.team}>
                  <td className="num text-[1.05rem] text-muted">{r.rank}</td>
                  <td className="!text-left">
                    <TeamLink abbr={r.team} season={data.season} className="inline-flex items-center gap-2 font-bold">
                      <TeamMark abbr={r.team} size={13} />
                      <span className="sm:hidden">{team(r.team)?.short ?? r.name}</span>
                      <span className="hidden sm:inline">{r.name}</span>
                    </TeamLink>
                  </td>
                  <td className="font-bold text-white">
                    <StatTap target={teamTarget(stat, data, r.team)} label={label(r)}>
                      {statValue(stat, r.value)}
                    </StatTap>
                  </td>
                  <td className={good ? "font-semibold text-[var(--tb)]" : "text-gray-300"}>
                    {stat.unit === "rate" ? `${delta >= 0 ? "+" : "−"}${Math.abs(delta * 100).toFixed(1)} pts` : `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(Math.max(1, stat.decimals))}`}
                  </td>
                  <td>{r.games}</td>
                  {stat.has_plays && <td className="text-muted">{r.plays}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  if (view === "bars") {
    // Bars start at zero for EPA (negatives in white stripes); other stats start from the
    // league's lowest value so the differences between teams are visible.
    const floor = signedScale ? 0 : lo - (hi - lo) * 0.15;
    const span = signedScale ? Math.max(Math.abs(lo), Math.abs(hi), 1e-9) : Math.max(hi - floor, 1e-9);
    return (
      <ol className="flex flex-col gap-2.5">
        {data.rows.map((r, i) => {
          const t = team(r.team);
          const share = signedScale ? Math.abs(r.value) / span : (r.value - floor) / span;
          const negative = signedScale && r.value < 0;
          return (
            <li key={r.team} className="grid grid-cols-[1.75rem_minmax(0,8.5rem)_minmax(0,1fr)_4.5rem] items-center gap-2.5 sm:grid-cols-[2rem_12rem_minmax(0,1fr)_5.5rem]">
              <span className="num text-right text-[1.05rem] text-faint">{r.rank}</span>
              <TeamLink abbr={r.team} season={data.season} className="flex min-w-0 items-center gap-2 font-bold">
                <TeamMark abbr={r.team} size={13} />
                <span className="truncate">{t?.short ?? r.name}</span>
              </TeamLink>
              <span className="h-3.5 overflow-hidden rounded-md bg-white/[0.06]" aria-hidden="true">
                <span
                  className={`grow-right block h-full rounded-md ${negative ? "neg-stripes" : ""}`}
                  style={{
                    width: `${Math.max(2, share * 100)}%`,
                    animationDelay: `${Math.min(i, 32) * 0.02}s`,
                    ...(negative
                      ? {}
                      : {
                          background: `linear-gradient(90deg, ${t?.primary ?? "#374151"}, ${t?.bright ?? "#9ca3af"})`,
                          boxShadow: i < 3 ? `0 0 14px -2px ${alpha(t?.bright ?? "#9ca3af", 0.8)}` : undefined,
                        }),
                  }}
                />
              </span>
              <StatTap target={teamTarget(stat, data, r.team)} label={label(r)} className="num justify-self-end text-[1.35rem] leading-none">
                {statValue(stat, r.value)}
              </StatTap>
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <ol className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-8">
      {data.rows.map((r) => {
        const t = team(r.team);
        const b = t?.bright ?? "#9ca3af";
        const podium = r.rank <= 3;
        return (
          <li
            key={r.team}
            className="relative flex flex-col gap-2 overflow-hidden rounded-[16px] p-3"
            style={{
              background: `linear-gradient(150deg, ${alpha(t?.primary ?? "#374151", podium ? 0.8 : 0.4)}, #0b0b0c 75%)`,
              border: `1px solid ${podium ? alpha(b, 0.6) : "rgba(255,255,255,0.08)"}`,
              boxShadow: podium ? `0 0 28px -10px ${alpha(b, 0.9)}` : undefined,
            }}
          >
            <span className="flex items-center justify-between">
              <span className="num text-[1.4rem] leading-none" style={{ color: podium ? b : "#6b7280" }}>
                {r.rank}
              </span>
              <TeamMark abbr={r.team} size={20} />
            </span>
            <TeamLink abbr={r.team} season={data.season} className="truncate text-sm font-bold text-white">
              {t?.short ?? r.name}
            </TeamLink>
            <StatTap target={teamTarget(stat, data, r.team)} label={label(r)} className="num self-start text-[1.8rem] leading-none text-white">
              {statValue(stat, r.value)}
            </StatTap>
          </li>
        );
      })}
    </ol>
  );
}
