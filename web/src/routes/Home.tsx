import { ArrowRight, ExternalLink } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { Notice, QueryState } from "../components/Notice";
import { TeamLink, TeamMark } from "../components/TeamMark";
import { ChipRow, Panel, Segmented, Select, type Option } from "../components/ui";
import type { ExplorerRow, Game, InjuryStatus, NewsItem } from "../lib/api";
import { ago, kickoff, num, shortDate, weekLabel } from "../lib/format";
import { alpha, useScreenTeam } from "../lib/palette";
import { useInjuries, useMeta, useNews, useStatCatalog, useTopPlayers, useWeek } from "../lib/queries";
import { explorerLink, rememberStat, rememberedStat, statGroups } from "../lib/stats";
import { team } from "../lib/teams";

const bright = (abbr: string | null | undefined, fallback = "#6b7280") => team(abbr)?.bright ?? fallback;

export function Home() {
  useScreenTeam(null);
  const meta = useMeta();
  const season = meta.data?.current_season;
  const [week, setWeek] = useState<number | undefined>(undefined);
  const games = useWeek(season, week);
  const shown = games.data;
  const kind = shown?.games[0]?.game_type === "REG" || !shown?.games.length ? "REG" : "POST";
  const title = shown ? weekLabel(shown.week, kind, shown.season) : "This week";

  return (
    <div className="flex flex-col gap-5">
      {shown && shown.games.length > 0 && <Ticker games={shown.games} />}

      <section className="rise relative flex flex-wrap items-end justify-between gap-5 pt-2" aria-label={title}>
        {shown && kind === "REG" && (
          <div
            aria-hidden="true"
            className="disp pointer-events-none absolute -top-2 right-0 text-[9rem] text-transparent sm:-top-6 sm:text-[14rem]"
            style={{ WebkitTextStroke: "2px color-mix(in srgb, var(--tb) 20%, transparent)" }}
          >
            {shown.week}
          </div>
        )}
        <div className="relative flex flex-col gap-1">
          <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-[var(--tb)]">
            {season ? `${season} season` : "Season"}
            {meta.data && <> · stats updated {ago(meta.data.built_at).toLowerCase()}</>}
          </span>
          <h1 className="disp text-[4.5rem] leading-[0.84] text-white sm:text-[6.5rem]">
            {kind === "REG" && shown ? (
              <>
                Week{" "}
                <span
                  className="bg-clip-text text-transparent"
                  style={{
                    backgroundImage: "linear-gradient(180deg, #fff 0%, var(--tb) 85%)",
                    filter: "drop-shadow(0 0 26px color-mix(in srgb, var(--tb) 60%, transparent))",
                  }}
                >
                  {shown.week}
                </span>
              </>
            ) : (
              title
            )}
          </h1>
        </div>
        {shown && shown.weeks.length > 1 && (
          <div className="relative max-w-full">
            <ChipRow
              options={shown.weeks.map((w) => ({ key: String(w), label: String(w) }))}
              value={String(shown.week)}
              onChange={(w) => setWeek(Number(w))}
              label="Week"
            />
          </div>
        )}
      </section>

      {shown && shown.games.length > 0 && <Facts games={shown.games} />}

      <Scores games={shown?.games ?? []} isPending={games.isPending || meta.isPending} error={games.error ?? meta.error} dim={games.isPlaceholderData} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Leaders season={season} />
        <Injuries season={season} />
      </div>

      <Headlines />
    </div>
  );
}

/** Scores scrolling across the top, like a broadcast crawl. Paused for reduced motion. */
function Ticker({ games }: { games: Game[] }) {
  const items = liveFirst(games).map((g) => {
    const live = g.live?.state === "in" ? g.live : null;
    const aw = g.is_final && (g.away.score ?? 0) > (g.home.score ?? 0);
    const hw = g.is_final && (g.home.score ?? 0) > (g.away.score ?? 0);
    return (
      <span key={g.game_id} className="inline-flex items-center gap-2 whitespace-nowrap border-r border-white/[0.07] px-5 py-2 text-[0.8125rem] font-semibold text-gray-300">
        <TeamMark abbr={g.away.team} size={11} />
        <span className={aw ? "font-extrabold text-white" : ""}>
          {g.away.team} {g.away.score ?? ""}
        </span>
        <span className="text-gray-600">·</span>
        <TeamMark abbr={g.home.team} size={11} />
        <span className={hw ? "font-extrabold text-white" : ""}>
          {g.home.team} {g.home.score ?? ""}
        </span>
        <span className={`inline-flex items-center gap-1.5 text-[0.625rem] font-extrabold tracking-[0.1em] ${g.is_final ? "text-faint" : "text-[var(--tb)]"}`}>
          {live && <span className="live-dot" />}
          {live ? live.detail.toUpperCase() : g.is_final ? (g.is_overtime ? "FINAL/OT" : "FINAL") : kickoff(g.kickoff_time_et).toUpperCase()}
        </span>
      </span>
    );
  });
  return (
    <div className="-mx-4 overflow-hidden border-y border-white/[0.08] bg-black/55 sm:mx-0 sm:rounded-full sm:border" aria-hidden="true">
      <div className="ticker flex w-max">
        {items}
        {items.map((el) => (
          <span key={`dup-${el.key}`} className="contents">
            {el}
          </span>
        ))}
      </div>
    </div>
  );
}

function Facts({ games }: { games: Game[] }) {
  const finals = games.filter((g) => g.is_final && g.home.score != null && g.away.score != null);
  const total = (g: Game) => (g.home.score ?? 0) + (g.away.score ?? 0);
  const margin = (g: Game) => Math.abs((g.home.score ?? 0) - (g.away.score ?? 0));
  const winnerFirst = (g: Game) => {
    const [w, l] = (g.home.score ?? 0) >= (g.away.score ?? 0) ? [g.home, g.away] : [g.away, g.home];
    return `${team(w.team)?.short ?? w.team} ${w.score}, ${team(l.team)?.short ?? l.team} ${l.score}`;
  };
  const pick = (score: (g: Game) => number, best: "max" | "min") =>
    finals.reduce<Game | undefined>((a, g) => (!a || (best === "max" ? score(g) > score(a) : score(g) < score(a)) ? g : a), undefined);
  const onNow = games.filter((g) => g.live?.state === "in");
  const next = games.find((g) => !g.is_final && g.live?.state !== "in");
  const high = pick(total, "max");
  const close = pick(margin, "min");
  const blowout = pick(margin, "max");

  const facts = [
    {
      label: "Games played",
      value: String(finals.length),
      unit: `/ ${games.length}`,
      note: onNow[0]
        ? `Live: ${onNow[0].away.team} ${onNow[0].away.score ?? 0}, ${onNow[0].home.team} ${onNow[0].home.score ?? 0}${onNow.length > 1 ? ` (+${onNow.length - 1} more)` : ""}`
        : next
          ? `Next: ${next.away.team} at ${next.home.team}, ${kickoff(next.kickoff_time_et)}`
          : "Week complete",
      teams: onNow[0] ? [onNow[0].away.team, onNow[0].home.team] : next ? [next.away.team, next.home.team] : [],
      glow: "var(--tb)",
    },
    high && { label: "Highest scoring", value: String(total(high)), unit: "pts", note: winnerFirst(high), teams: [high.away.team, high.home.team], glow: bright(high.home.team) },
    close && { label: "Closest finish", value: String(margin(close)), unit: "pts", note: winnerFirst(close), teams: [close.away.team, close.home.team], glow: bright(close.home.team) },
    blowout && { label: "Biggest win", value: String(margin(blowout)), unit: "pts", note: winnerFirst(blowout), teams: [blowout.away.team, blowout.home.team], glow: bright(blowout.home.team) },
  ].filter(Boolean) as Array<{ label: string; value: string; unit: string; note: string; teams: string[]; glow: string }>;

  return (
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="This week at a glance">
      {facts.map((f, i) => (
        <li
          key={f.label}
          className="panel rise flex flex-col gap-1.5 overflow-hidden p-4"
          style={{
            animationDelay: `${0.04 * i}s`,
            background: `radial-gradient(220px 140px at 100% 0%, color-mix(in srgb, ${f.glow} 32%, transparent), transparent 70%), linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.015))`,
          }}
        >
          <span className="text-[0.6875rem] font-extrabold uppercase tracking-[0.12em] text-muted">{f.label}</span>
          <span className="num text-[2.75rem] leading-[0.95] text-white sm:text-[3.5rem]">
            {f.value}
            <span className="text-[1.25rem] text-muted"> {f.unit}</span>
          </span>
          <span className="flex items-start gap-1.5 text-[0.8125rem] font-medium leading-snug text-gray-300">
            {f.teams.length > 0 && (
              <span className="mt-1 flex shrink-0 gap-1">
                {f.teams.map((t) => (
                  <TeamMark key={t} abbr={t} size={11} />
                ))}
              </span>
            )}
            <span className="min-w-0">{f.note}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

type ScoresView = "cards" | "compact";
const SCORE_VIEWS: readonly Option<ScoresView>[] = [
  { key: "cards", label: "Cards" },
  { key: "compact", label: "Compact" },
];

/** Games on now come first; everything else keeps kickoff order. */
function liveFirst(games: Game[]): Game[] {
  return [...games.filter((g) => g.live?.state === "in"), ...games.filter((g) => g.live?.state !== "in")];
}

function Scores({ games: all, isPending, error, dim }: { games: Game[]; isPending: boolean; error: unknown; dim: boolean }) {
  const [view, setView] = useState<ScoresView>("cards");
  const games = liveFirst(all);
  return (
    <Panel title="Scores" delay={0.1} actions={<Segmented options={SCORE_VIEWS} value={view} onChange={setView} label="Scores view" />}>
      <QueryState isPending={isPending} error={error} empty={games.length === 0} emptyText="No games scheduled this week." rows={4}>
        {view === "cards" ? (
          <ul className={`grid gap-3 sm:grid-cols-2 xl:grid-cols-4 ${dim ? "opacity-60" : ""}`}>
            {games.map((g) => (
              <li key={g.game_id}>
                <GameCard game={g} />
              </li>
            ))}
          </ul>
        ) : (
          <ul className={`flex flex-col gap-1 ${dim ? "opacity-60" : ""}`}>
            {games.map((g) => (
              <li key={g.game_id}>
                <GameRow game={g} />
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-faint">Scores and stats refresh once a day, early each morning.</p>
      </QueryState>
    </Panel>
  );
}

function outcome(g: Game) {
  const aw = g.is_final && (g.away.score ?? 0) > (g.home.score ?? 0);
  const hw = g.is_final && (g.home.score ?? 0) > (g.away.score ?? 0);
  return { aw, hw };
}

function status(g: Game) {
  if (g.live?.state === "in") return g.live.detail;
  if (g.is_final) return g.is_overtime ? "Final/OT" : "Final";
  return `${shortDate(g.game_date).split(",")[0] ?? ""} ${kickoff(g.kickoff_time_et)}`.trim();
}

function LiveBadge({ detail }: { detail: string }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-white" style={{ background: "var(--tb)", boxShadow: "0 0 16px -2px var(--tb)" }}>
      <span className="live-dot" aria-hidden="true" />
      Live · {detail}
    </span>
  );
}

function GameCard({ game: g }: { game: Game }) {
  const { aw, hw } = outcome(g);
  const live = g.live?.state === "in" ? g.live : null;
  const label = `${team(g.away.team)?.name ?? g.away.team} ${g.away.score ?? ""} at ${team(g.home.team)?.name ?? g.home.team} ${g.home.score ?? ""}, ${live ? `live, ${live.detail}` : status(g)}`;
  return (
    <article
      aria-label={label}
      className="relative flex flex-col gap-3 overflow-hidden rounded-[18px] p-4 transition-transform duration-200 hover:-translate-y-0.5"
      style={{
        background: "#0b0b0c",
        border: g.is_final ? "1px solid rgba(255,255,255,0.1)" : "1px solid var(--tb)",
        boxShadow: g.is_final ? undefined : "0 0 34px -8px color-mix(in srgb, var(--tb) 80%, transparent)",
      }}
      data-live={live ? "true" : undefined}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(140px 110px at 0% 0%, ${alpha(bright(g.away.team), aw ? 0.55 : 0.28)}, transparent 75%), radial-gradient(150px 120px at 100% 100%, ${alpha(bright(g.home.team), hw ? 0.55 : 0.28)}, transparent 75%), repeating-linear-gradient(115deg, rgba(255,255,255,0.03) 0 2px, transparent 2px 16px)`,
        }}
      />
      <div className="relative flex items-center justify-between text-[0.6875rem] font-extrabold uppercase tracking-[0.1em] text-gray-300" aria-hidden="true">
        <span>{shortDate(g.game_date)}</span>
        {live ? (
          <LiveBadge detail={live.detail} />
        ) : g.is_final ? (
          <span className="text-muted">{status(g)}</span>
        ) : (
          <span className="rounded-full px-2 py-0.5 text-white" style={{ background: "var(--tb)" }}>
            {kickoff(g.kickoff_time_et)}
          </span>
        )}
      </div>
      {([
        [g.away, aw],
        [g.home, hw],
      ] as const).map(([side, won]) => (
        <div key={side.team} className="relative flex items-center gap-2.5">
          <TeamLink abbr={side.team} season={g.season} className="flex min-w-0 flex-1 items-center gap-2.5">
            <TeamMark abbr={side.team} size={16} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={`num flex items-center gap-1.5 truncate text-[1.5rem] leading-none ${won || !g.is_final ? "text-white" : "text-muted"}`}>
                {team(side.team)?.short ?? side.team}
                {live?.possession === side.team && <span className="possession" title="Has the ball" aria-label="has the ball" />}
              </span>
              {side.qb_name && (
                <span className="truncate text-xs text-faint" aria-hidden="true">
                  {side.qb_name}
                </span>
              )}
            </span>
          </TeamLink>
          {side.score != null && (
            <span aria-hidden="true" className={`num text-[2.5rem] leading-[0.9] ${won ? "text-white" : "text-faint"}`} style={won ? { textShadow: "0 0 18px rgba(255,255,255,0.35)" } : undefined}>
              {side.score}
            </span>
          )}
        </div>
      ))}
      {live && (live.down_distance || live.last_play) && (
        <div className="relative flex flex-col gap-1 border-t border-white/[0.08] pt-2.5 text-xs" aria-hidden="true">
          {live.down_distance && (
            <span className="flex items-center gap-2 font-bold text-gray-200">
              {live.down_distance}
              {live.red_zone && <span className="rounded-full bg-white px-1.5 py-px text-[0.625rem] font-extrabold uppercase tracking-[0.08em] text-black">Red zone</span>}
            </span>
          )}
          {live.last_play && <span className="line-clamp-2 text-faint">{live.last_play}</span>}
        </div>
      )}
      {!live && !g.is_final && g.spread_line != null && (
        <p className="relative text-xs font-semibold text-gray-300">
          {g.spread_line === 0 ? "Pick'em" : `${g.spread_line > 0 ? g.home.team : g.away.team} by ${Math.abs(g.spread_line)}`}
          {g.total_line != null && <> · O/U {g.total_line}</>}
        </p>
      )}
    </article>
  );
}

function GameRow({ game: g }: { game: Game }) {
  const { aw, hw } = outcome(g);
  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)_4.5rem_minmax(0,1fr)] items-center gap-3 rounded-[12px] px-3 py-2.5 sm:grid-cols-[6rem_minmax(0,1fr)_5.5rem_minmax(0,1fr)_5.5rem]"
      style={{
        background: `linear-gradient(90deg, ${alpha(bright(g.away.team), aw ? 0.22 : 0.07)}, rgba(255,255,255,0.02) 40%, rgba(255,255,255,0.02) 60%, ${alpha(bright(g.home.team), hw ? 0.22 : 0.07)})`,
      }}
    >
      <span className="hidden text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-muted sm:block">{shortDate(g.game_date)}</span>
      <TeamLink abbr={g.away.team} season={g.season} className="flex min-w-0 items-center justify-end gap-2">
        <span className={`num truncate text-[1.25rem] ${aw || !g.is_final ? "text-white" : "text-muted"}`}>{team(g.away.team)?.short ?? g.away.team}</span>
        <TeamMark abbr={g.away.team} size={14} />
      </TeamLink>
      <span className="num flex flex-col items-center text-center text-[1.5rem] leading-none text-white">
        {g.is_final || g.live?.state === "in" ? `${g.away.score ?? 0}–${g.home.score ?? 0}` : kickoff(g.kickoff_time_et).replace(" ET", "")}
        {g.live?.state === "in" && (
          <span className="mt-1 flex items-center gap-1 font-sans text-[0.625rem] font-extrabold not-italic uppercase tracking-[0.08em] text-[var(--tb)] sm:hidden">
            <span className="live-dot" aria-hidden="true" /> {g.live.detail}
          </span>
        )}
      </span>
      <TeamLink abbr={g.home.team} season={g.season} className="flex min-w-0 items-center gap-2">
        <TeamMark abbr={g.home.team} size={14} />
        <span className={`num truncate text-[1.25rem] ${hw || !g.is_final ? "text-white" : "text-muted"}`}>{team(g.home.team)?.short ?? g.home.team}</span>
      </TeamLink>
      <span className={`hidden items-center justify-end gap-1.5 text-right text-[0.6875rem] font-extrabold uppercase tracking-[0.1em] sm:flex ${g.is_final ? "text-muted" : "text-[var(--tb)]"}`}>
        {g.live?.state === "in" && <span className="live-dot" aria-hidden="true" />}
        {g.live?.state === "in" ? g.live.detail : g.is_final ? status(g) : "Upcoming"}
      </span>
    </div>
  );
}

type LeadersView = "ranked" | "bars";
const LEADER_VIEWS: readonly Option<LeadersView>[] = [
  { key: "ranked", label: "Ranked" },
  { key: "bars", label: "Bars" },
];
const DEFAULT_LEADER_STAT = "passing_yards";

function Leaders({ season }: { season: number | undefined }) {
  const catalog = useStatCatalog();
  const stats = catalog.data?.stats ?? [];
  const [chosen, setChosen] = useState<string>(() => rememberedStat() ?? DEFAULT_LEADER_STAT);
  // A remembered stat that no longer exists falls back to the default.
  const stat = stats.length && !stats.some((s) => s.key === chosen) ? DEFAULT_LEADER_STAT : chosen;
  const top = useTopPlayers({ stat, season }, 5);
  const [view, setView] = useState<LeadersView>("ranked");
  const data = top.data;
  const rows = data?.rows ?? [];
  const decimals = data?.stat.decimals ?? 0;
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  const choose = (key: string) => {
    setChosen(key);
    rememberStat(key);
  };

  return (
    <Panel
      title="League leaders"
      subtitle={data?.through_week ? `Regular season, through week ${data.through_week}` : "Regular season"}
      delay={0.15}
      actions={<Segmented options={LEADER_VIEWS} value={view} onChange={setView} label="Leaders view" />}
    >
      {stats.length > 0 && (
        <Select value={stat} onChange={choose} label="Stat" prefix="Stat" groups={statGroups(stats)} className="w-full sm:w-auto sm:self-start" />
      )}
      <QueryState isPending={top.isPending || catalog.isPending} error={top.error ?? catalog.error} empty={rows.length === 0} emptyText="Nobody has recorded this stat yet this season." rows={5}>
        <div className={`flex flex-col gap-4 transition-opacity ${top.isPlaceholderData ? "opacity-60" : ""}`}>
          {view === "ranked" ? (
            <ol className="flex flex-col gap-2">
              {rows.map((r) => (
                <li key={r.player_id}>
                  <LeaderLink row={r} rank={r.rank} decimals={decimals} />
                </li>
              ))}
            </ol>
          ) : (
            <ol className="flex flex-col gap-4">
              {rows.map((r, i) => (
                <li key={r.player_id}>
                  <Link to={`/players/${r.player_id}`} className="group flex flex-col gap-1.5">
                    <span className="flex items-baseline justify-between text-sm font-semibold">
                      <span className="group-hover:underline group-hover:underline-offset-4">
                        {r.name} <span className="text-faint">{r.team}</span>
                      </span>
                      <span className="num text-[1.5rem]">{num(r.value, decimals)}</span>
                    </span>
                    <span className="block h-4 overflow-hidden rounded-md bg-white/[0.06]">
                      <span
                        className={`grow-right block h-full rounded-md ${r.value < 0 ? "neg-stripes" : ""}`}
                        style={{
                          width: `${(Math.abs(r.value) / max) * 100}%`,
                          animationDelay: `${i * 0.08}s`,
                          ...(r.value < 0
                            ? {}
                            : {
                                background: `linear-gradient(90deg, ${team(r.team)?.primary ?? "#374151"}, ${bright(r.team)})`,
                                boxShadow: `0 0 18px -2px ${alpha(bright(r.team), 0.8)}, inset 0 1px 0 rgba(255,255,255,0.35)`,
                              }),
                        }}
                      />
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
          {data && (
            <Link
              to={explorerLink(stat, data.season)}
              className="group flex min-h-12 items-center justify-between gap-3 rounded-[14px] border border-white/[0.1] bg-white/[0.03] px-4 font-bold transition-colors hover:border-[var(--tb)] hover:bg-white/[0.06]"
            >
              <span>
                See all {data.total} players <span className="font-medium text-muted">in the Explorer</span>
              </span>
              <ArrowRight size={18} aria-hidden="true" className="text-[var(--tb)] transition-transform group-hover:translate-x-1" />
            </Link>
          )}
        </div>
      </QueryState>
    </Panel>
  );
}

function LeaderLink({ row: r, rank, decimals }: { row: ExplorerRow; rank: number; decimals: number }) {
  const first = rank === 1;
  const b = bright(r.team);
  const p = team(r.team)?.primary ?? "#374151";
  return (
    <Link
      to={`/players/${r.player_id}`}
      className="relative flex items-center gap-3 overflow-hidden rounded-[14px] px-3.5 transition-transform duration-200 hover:-translate-y-0.5"
      style={
        first
          ? {
              padding: "1rem 0.875rem",
              background: `linear-gradient(100deg, ${alpha(p, 0.85)}, ${alpha(b, 0.35)} 55%, rgba(255,255,255,0.03))`,
              border: `1px solid ${alpha(b, 0.7)}`,
              boxShadow: `0 0 34px -10px ${alpha(b, 0.9)}`,
            }
          : {
              padding: "0.7rem 0.875rem",
              background: `linear-gradient(90deg, ${alpha(b, 0.14)}, rgba(255,255,255,0.02) 45%)`,
              border: "1px solid rgba(255,255,255,0.06)",
            }
      }
    >
      {first && (
        <span
          aria-hidden="true"
          className="sweep pointer-events-none absolute inset-y-0 left-0 w-1/5"
          style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent)" }}
        />
      )}
      <span className="num relative w-7 text-[1.85rem] leading-none" style={{ color: first ? b : "#4b5563" }}>
        {rank}
      </span>
      <TeamMark abbr={r.team} size={14} />
      <span className="relative flex min-w-0 flex-1 flex-col">
        <span className="truncate font-bold text-white">{r.name}</span>
        <span className="text-xs font-semibold text-gray-300">
          {r.position} · {team(r.team)?.short ?? r.team} · {r.games} games
        </span>
      </span>
      <span className={`num relative leading-none text-white ${first ? "text-[2.25rem]" : "text-[1.75rem]"}`}>{num(r.value, decimals)}</span>
    </Link>
  );
}

const STATUS_COLOR: Record<InjuryStatus, string> = { Out: "var(--tb)", Doubtful: "#ffffff", Questionable: "#6b7280" };

function Injuries({ season }: { season: number | undefined }) {
  const injuries = useInjuries(season);
  const [statusKey, setStatus] = useState<InjuryStatus>("Out");
  const [all, setAll] = useState(false);
  const data = injuries.data;
  const counts = data?.counts ?? { Out: 0, Doubtful: 0, Questionable: 0 };
  const total = counts.Out + counts.Doubtful + counts.Questionable;
  const rows = (data?.rows ?? []).filter((r) => r.status === statusKey);
  const visible = all ? rows : rows.slice(0, 8);

  let offset = 25;
  const arcs = (["Out", "Doubtful", "Questionable"] as const).map((s) => {
    const share = total ? (counts[s] / total) * 100 : 0;
    const arc = { s, share, offset };
    offset -= share;
    return arc;
  });

  return (
    <Panel title="Injury report" subtitle={data?.week ? `Week ${data.week}` : undefined} delay={0.2}>
      <QueryState isPending={injuries.isPending} error={injuries.error} empty={!data?.week} rows={5}>
        <div className="flex items-center gap-5">
          <svg
            width="128"
            height="128"
            viewBox="0 0 42 42"
            role="img"
            aria-label={`${total} players listed: ${counts.Out} out, ${counts.Doubtful} doubtful, ${counts.Questionable} questionable`}
            className="shrink-0"
            style={{ filter: "drop-shadow(0 0 14px color-mix(in srgb, var(--tb) 45%, transparent))" }}
          >
            <circle cx="21" cy="21" r="15.915" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5.5" />
            {arcs.map((a) => (
              <circle
                key={a.s}
                cx="21"
                cy="21"
                r="15.915"
                fill="none"
                strokeWidth="5.5"
                strokeDasharray={`${a.share} ${100 - a.share}`}
                strokeDashoffset={a.offset}
                style={{ stroke: STATUS_COLOR[a.s] }}
              />
            ))}
            <text x="21" y="22.5" textAnchor="middle" className="num" fontSize="11" fill="#fff">
              {total}
            </text>
            <text x="21" y="27.5" textAnchor="middle" fontSize="3" fontWeight="700" fill="#9ca3af" letterSpacing="0.3">
              LISTED
            </text>
          </svg>
          <div className="flex flex-1 flex-col gap-2" role="group" aria-label="Game status">
            {(["Out", "Doubtful", "Questionable"] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={s === statusKey}
                onClick={() => {
                  setStatus(s);
                  setAll(false);
                }}
                className="flex min-h-11 items-center gap-2.5 rounded-[12px] px-3.5 text-sm font-bold text-ink"
                style={{
                  background: s === statusKey ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${s === statusKey ? STATUS_COLOR[s] : "rgba(255,255,255,0.07)"}`,
                }}
              >
                <span aria-hidden="true" className="h-3 w-3 rounded-[3px]" style={{ background: STATUS_COLOR[s], boxShadow: `0 0 12px ${STATUS_COLOR[s]}` }} />
                <span className="flex-1 text-left">{s}</span>
                <span className="num text-[1.4rem]">{counts[s]}</span>
              </button>
            ))}
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">Nobody listed as {statusKey.toLowerCase()} this week.</p>
        ) : (
          <ul className="flex flex-col">
            {visible.map((r) => (
              <li key={`${r.team}-${r.player_name}`} className="flex items-center gap-3 border-b border-white/[0.06] py-2.5 last:border-b-0">
                <TeamLink abbr={r.team} season={season} className="shrink-0" label={`${team(r.team)?.name ?? r.team} team page`}>
                  <TeamMark abbr={r.team} size={12} />
                </TeamLink>
                <span className="flex min-w-0 flex-1 flex-col">
                  {r.player_id ? (
                    <Link to={`/players/${r.player_id}`} className="truncate font-bold hover:underline hover:underline-offset-4">
                      {r.player_name}
                    </Link>
                  ) : (
                    <span className="truncate font-bold">{r.player_name}</span>
                  )}
                  <span className="truncate text-xs font-medium text-muted">
                    {[r.position, team(r.team)?.short ?? r.team, r.injury].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span
                  className="rounded-full px-2.5 py-1 text-[0.6875rem] font-extrabold uppercase tracking-[0.08em]"
                  style={
                    r.status === "Out"
                      ? { background: "var(--tb)", color: "#fff" }
                      : r.status === "Doubtful"
                        ? { background: "#fff", color: "#0a0a0a" }
                        : { background: "rgba(255,255,255,0.12)", color: "#e5e7eb" }
                  }
                >
                  {r.status}
                </span>
              </li>
            ))}
          </ul>
        )}
        {rows.length > 8 && (
          <button type="button" className="pill self-start" onClick={() => setAll((v) => !v)}>
            {all ? "Show fewer" : `Show all ${rows.length}`}
          </button>
        )}
      </QueryState>
    </Panel>
  );
}

function Headlines() {
  const news = useNews();
  const items = news.data?.items ?? [];
  const sources = [...new Set(items.map((i) => i.source))].sort();
  const [source, setSource] = useState("all");
  const [all, setAll] = useState(false);
  const filtered = source === "all" ? items : items.filter((i) => i.source === source);
  const visible = all ? filtered : filtered.slice(0, 9);
  const failed = news.data?.sources_failed ?? [];

  return (
    <Panel
      title="Headlines"
      subtitle={news.data?.fetched_at ? `Updated ${ago(news.data.fetched_at).toLowerCase()}` : undefined}
      delay={0.25}
    >
      <QueryState
        isPending={news.isPending}
        error={news.error}
        empty={items.length === 0}
        emptyText={
          failed.length
            ? `Couldn't load headlines from ${failed.join(", ")}. They'll retry in 15 minutes.`
            : "Headlines are loading for the first time. Check back in a minute."
        }
        rows={4}
      >
        {sources.length > 1 && (
          <ChipRow
            options={[{ key: "all", label: "All" }, ...sources.map((s) => ({ key: s, label: s }))]}
            value={source}
            onChange={(s) => {
              setSource(s);
              setAll(false);
            }}
            label="Source"
          />
        )}
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((item, i) => (
            <li key={item.url}>
              <HeadlineCard item={item} lead={i === 0} />
            </li>
          ))}
        </ul>
        {filtered.length > 9 && (
          <button type="button" className="pill self-start" onClick={() => setAll((v) => !v)}>
            {all ? "Show fewer" : `Show all ${filtered.length}`}
          </button>
        )}
        {failed.length > 0 && <Notice>Not loading right now: {failed.join(", ")}.</Notice>}
      </QueryState>
    </Panel>
  );
}

function HeadlineCard({ item, lead }: { item: NewsItem; lead: boolean }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex h-full flex-col gap-2.5 rounded-[16px] p-4 transition-transform duration-200 hover:-translate-y-0.5"
      style={
        lead
          ? {
              background: "linear-gradient(140deg, color-mix(in srgb, var(--tb) 30%, transparent), rgba(255,255,255,0.03) 60%)",
              border: "1px solid color-mix(in srgb, var(--tb) 50%, transparent)",
            }
          : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }
      }
    >
      <span className="flex items-center justify-between gap-2 text-[0.6875rem] font-extrabold uppercase tracking-[0.1em] text-[var(--tb)]">
        <span className="truncate">
          {item.source}
          {item.published_at && <> · {ago(item.published_at)}</>}
        </span>
        <ExternalLink size={14} className="shrink-0 text-faint" aria-hidden="true" />
      </span>
      <span className="text-base font-bold leading-snug text-white group-hover:underline group-hover:underline-offset-4">{item.title}</span>
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}
