import { ArrowLeft } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { Notice, Skeleton, errorText } from "../components/Notice";
import { StandingsTable } from "../components/Standings";
import { StatTap } from "../components/StatTap";
import { TeamLink, TeamMark } from "../components/TeamMark";
import { ChipRow, HeroFrame, Panel, Segmented, Stat, type Option } from "../components/ui";
import {
  ApiError,
  type InjuryStatus,
  type LeaderBoard,
  type StandingRow,
  type TeamGame,
  type TeamProfile,
  type TeamRank,
} from "../lib/api";
import { kickoff, num, ordinal, pctText, shortDate, signed, weekLabel, winPct, wlt } from "../lib/format";
import { useCountUp, useWidth } from "../lib/motion";
import { alpha, useScreenTeam } from "../lib/palette";
import type { PlaysTarget } from "../lib/plays";
import { useTeam } from "../lib/queries";
import { statValue } from "../lib/stats";
import { team } from "../lib/teams";

function bright(abbr: string): string {
  return team(abbr)?.bright ?? "#9ca3af";
}

export function Team() {
  const { abbr: raw } = useParams();
  const abbr = raw?.toUpperCase();
  const [params, setParams] = useSearchParams();
  const asked = Number(params.get("season")) || undefined;
  const query = useTeam(abbr, asked);
  const p = query.data;
  useScreenTeam(p ? p.info.team : abbr);

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-5">
        <div className="h-[22rem] animate-pulse rounded-[26px] bg-white/[0.05]" aria-hidden="true" />
        <Skeleton rows={2} className="h-64" />
      </div>
    );
  }
  if (query.error || !p) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <Notice tone="alert">{missing ? "We couldn't find that team. Pick one from the Teams page." : errorText(query.error)}</Notice>
      </div>
    );
  }

  const setSeason = (s: number) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("season", String(s));
        return next;
      },
      { replace: true },
    );
  const played = p.games.filter((g) => g.result);

  return (
    <div className={`flex flex-col gap-5 transition-opacity ${query.isPlaceholderData ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackLink season={p.season} />
        {p.seasons.length > 1 && (
          <ChipRow
            options={p.seasons.map((s) => ({ key: String(s), label: String(s) }))}
            value={String(p.season)}
            onChange={(s) => setSeason(Number(s))}
            label="Season"
          />
        )}
      </div>

      <Hero profile={p} />

      <Schedule profile={p} />

      {played.length > 0 && <GameByGame profile={p} games={played} />}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Ranks ranks={p.ranks} team={p.info.team} season={p.season} />
        <div className="flex flex-col gap-5">
          {p.division.length > 0 && <Division profile={p} />}
          {p.injuries.length > 0 && <TeamInjuries profile={p} />}
        </div>
      </div>

      <Leaders boards={p.leaders} team={p.info.team} season={p.season} />
    </div>
  );
}

function BackLink({ season }: { season?: number }) {
  return (
    <Link
      to={season ? `/teams?season=${season}` : "/teams"}
      className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"
    >
      <ArrowLeft size={16} aria-hidden="true" />
      Teams
    </Link>
  );
}

/* ------------------------------------------------------------------ hero */

function splitTeamName(name: string, nickname: string | null): [string, string] {
  if (nickname && name.endsWith(nickname)) return [name.slice(0, -nickname.length).trim(), nickname];
  const parts = name.split(" ");
  return [parts.slice(0, -1).join(" "), parts.at(-1) ?? name];
}

function ResultChip({ result }: { result: TeamGame["result"] }) {
  const win = result === "W";
  return (
    <span
      className="grid h-7 w-7 place-items-center rounded-full text-[0.75rem] font-extrabold"
      style={
        win
          ? { background: "var(--tb)", color: "#fff", boxShadow: "0 0 14px -2px color-mix(in srgb, var(--tb) 85%, transparent)" }
          : { background: "rgba(255,255,255,0.08)", color: "#e5e7eb", border: "1px solid rgba(255,255,255,0.28)" }
      }
    >
      {result}
    </span>
  );
}

function Hero({ profile: p }: { profile: TeamProfile }) {
  const { info, record: r } = p;
  const t = useCountUp(`${info.team}-${p.season}`);
  const [city, nick] = splitTeamName(info.name, info.nickname);
  const diff = r.points_for - r.points_against;
  const form = p.games.filter((g) => g.result).slice(-5);
  const place =
    p.division_rank && info.division
      ? `${info.division} · ${ordinal(p.division_rank)}`
      : (info.conference ?? `${p.season} season`);

  return (
    <HeroFrame watermark={(info.nickname ?? info.team).toUpperCase()} emblem={info.team}>
      <div className="flex flex-col gap-3.5">
        <div className="flex items-center gap-2.5">
          <TeamMark abbr={info.team} size={16} />
          <span className="text-[0.8125rem] font-extrabold uppercase tracking-[0.12em] text-[var(--tb)]">
            {p.season} · {place}
          </span>
        </div>
        <h1 className="disp text-[3.75rem] leading-[0.86] text-white sm:text-[6rem]">
          {city}
          <br />
          <span
            className="bg-clip-text text-transparent"
            style={{
              backgroundImage: "linear-gradient(90deg, #fff 10%, var(--tb) 55%, var(--ts))",
              filter: "drop-shadow(0 0 22px color-mix(in srgb, var(--tb) 45%, transparent))",
            }}
          >
            {nick}
          </span>
        </h1>
        {form.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-gray-300">Last {form.length}</span>
            <ol className="flex gap-1.5" aria-label={`Last ${form.length} results: ${form.map((g) => g.result).join(", ")}`}>
              {form.map((g) => (
                <li key={g.game_id} aria-hidden="true">
                  <ResultChip result={g.result} />
                </li>
              ))}
            </ol>
            {r.streak && <span className="text-sm font-semibold text-gray-300">· Streak {r.streak}</span>}
          </div>
        )}
        <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-2.5">
          <Stat
            accent
            label="Record"
            value={wlt(Math.round(r.wins * t), Math.round(r.losses * t), Math.round(r.ties * t))}
          />
          <Stat
            label={`Points ${r.points_for}–${r.points_against}`}
            value={diff === 0 ? "0" : signed(Math.round(diff * t), 0)}
          />
          <Stat label="At home" value={r.home} />
          <Stat label="On the road" value={r.away} />
        </div>
      </div>
    </HeroFrame>
  );
}

/* -------------------------------------------------------------- schedule */

type ScheduleView = "cards" | "list";
const SCHEDULE_VIEWS: readonly Option<ScheduleView>[] = [
  { key: "cards", label: "Cards" },
  { key: "list", label: "List" },
];

type Slot = { kind: "game"; game: TeamGame } | { kind: "bye"; week: number };

/** Regular-season games with bye weeks filled in, then the playoffs. */
function slots(games: TeamGame[]): Slot[] {
  const reg = games.filter((g) => g.game_type === "REG");
  const post = games.filter((g) => g.game_type !== "REG");
  const out: Slot[] = [];
  const last = Math.max(0, ...reg.map((g) => g.week));
  for (let w = 1; w <= last; w++) {
    const g = reg.find((x) => x.week === w);
    out.push(g ? { kind: "game", game: g } : { kind: "bye", week: w });
  }
  return [...out, ...post.map((game) => ({ kind: "game" as const, game }))];
}

function lineText(g: TeamGame, abbr: string): string | null {
  if (g.team_line == null) return null;
  if (g.team_line === 0) return "Pick'em";
  return g.team_line < 0 ? `${abbr} by ${Math.abs(g.team_line)}` : `${g.opponent} by ${g.team_line}`;
}

function gameWeek(g: TeamGame, season: number): string {
  return weekLabel(g.week, g.game_type === "REG" ? "REG" : "POST", season);
}

function Schedule({ profile: p }: { profile: TeamProfile }) {
  const [view, setView] = useState<ScheduleView>("cards");
  const all = useMemo(() => slots(p.games), [p.games]);
  const next = p.games.find((g) => !g.result);
  return (
    <Panel
      title="Schedule"
      subtitle={next ? `Next: ${next.is_home ? "vs" : "at"} ${team(next.opponent)?.name ?? next.opponent}, ${shortDate(next.game_date)}` : "Season complete"}
      delay={0.08}
      actions={<Segmented options={SCHEDULE_VIEWS} value={view} onChange={setView} label="Schedule view" />}
    >
      {view === "cards" ? (
        <ol className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          {all.map((s) =>
            s.kind === "bye" ? (
              <li
                key={`bye-${s.week}`}
                className="flex min-h-[8.5rem] flex-col justify-between rounded-[16px] border border-dashed border-white/[0.12] p-3 text-muted"
              >
                <span className="text-[0.6875rem] font-extrabold uppercase tracking-[0.1em]">Week {s.week}</span>
                <span className="disp text-[1.75rem]">Bye</span>
              </li>
            ) : (
              <ScheduleCard key={s.game.game_id} game={s.game} profile={p} isNext={s.game === next} />
            ),
          )}
        </ol>
      ) : (
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="data-table">
            <caption className="sr-only">
              {p.info.name} {p.season} schedule
            </caption>
            <thead>
              <tr>
                <th scope="col">Week</th>
                <th scope="col" className="!text-left">
                  Opponent
                </th>
                <th scope="col">Result</th>
                <th scope="col">Line</th>
                <th scope="col" className="!text-left">
                  Quarterbacks
                </th>
              </tr>
            </thead>
            <tbody>
              {p.games.map((g) => (
                <tr key={g.game_id}>
                  <td className="font-semibold">{gameWeek(g, p.season)}</td>
                  <td className="!text-left">
                    <TeamLink abbr={g.opponent} season={p.season} className="inline-flex items-center gap-2 font-semibold">
                      <span className="w-5 text-muted">{g.is_home ? "vs" : "at"}</span>
                      <TeamMark abbr={g.opponent} size={12} />
                      {team(g.opponent)?.name ?? g.opponent}
                    </TeamLink>
                  </td>
                  <td>
                    {g.result ? (
                      <span className="font-bold">
                        <span className={g.result === "W" ? "text-[var(--tb)]" : "text-gray-300"}>{g.result}</span>{" "}
                        {g.points_for}–{g.points_against}
                        {g.is_overtime ? " OT" : ""}
                      </span>
                    ) : (
                      <span className="text-muted">
                        {shortDate(g.game_date)} {kickoff(g.kickoff_time_et).replace(" ET", "")}
                      </span>
                    )}
                  </td>
                  <td className="text-muted">{lineText(g, p.info.team) ?? "–"}</td>
                  <td className="!text-left text-muted">
                    {g.qb_name || g.opponent_qb_name ? `${g.qb_name ?? "?"} vs ${g.opponent_qb_name ?? "?"}` : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function ScheduleCard({ game: g, profile: p, isNext }: { game: TeamGame; profile: TeamProfile; isNext: boolean }) {
  const win = g.result === "W";
  const line = lineText(g, p.info.team);
  return (
    <li
      className="relative flex min-h-[8.5rem] flex-col justify-between gap-2 overflow-hidden rounded-[16px] p-3"
      style={{
        background: "#0b0b0c",
        border: isNext ? "1px solid var(--tb)" : "1px solid rgba(255,255,255,0.09)",
        boxShadow: isNext ? "0 0 30px -8px color-mix(in srgb, var(--tb) 80%, transparent)" : undefined,
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(120px 100px at 100% 0%, ${alpha(bright(g.opponent), 0.3)}, transparent 75%)${
            win ? ", radial-gradient(140px 90px at 0% 100%, color-mix(in srgb, var(--tb) 38%, transparent), transparent 75%)" : ""
          }`,
        }}
      />
      <div className="relative flex items-center justify-between text-[0.6875rem] font-extrabold uppercase tracking-[0.1em] text-gray-300">
        <span>{gameWeek(g, p.season)}</span>
        {g.is_division_game && <span className="text-faint">Division</span>}
      </div>
      <TeamLink abbr={g.opponent} season={p.season} className="relative flex items-center gap-2">
        <span className="text-xs font-bold text-muted">{g.is_home ? "vs" : "at"}</span>
        <TeamMark abbr={g.opponent} size={15} />
        <span className="num truncate text-[1.35rem] leading-none text-white">{team(g.opponent)?.short ?? g.opponent}</span>
      </TeamLink>
      {g.result ? (
        <div className="relative flex items-center gap-2">
          <ResultChip result={g.result} />
          <span className={`num text-[1.6rem] leading-none ${win ? "text-white" : "text-gray-300"}`}>
            {g.points_for}–{g.points_against}
          </span>
          {g.is_overtime && <span className="text-[0.6875rem] font-extrabold text-muted">OT</span>}
        </div>
      ) : (
        <div className="relative flex flex-col text-xs font-semibold text-gray-300">
          <span>
            {shortDate(g.game_date)}
            {g.kickoff_time_et && ` · ${kickoff(g.kickoff_time_et)}`}
          </span>
          {line && <span className="text-muted">{line}</span>}
        </div>
      )}
    </li>
  );
}

/* ---------------------------------------------------------- game by game */

type TrendView = "margin" | "scores" | "table";
const TREND_VIEWS: readonly Option<TrendView>[] = [
  { key: "margin", label: "Margin" },
  { key: "scores", label: "Scores" },
  { key: "table", label: "Table" },
];

function GameByGame({ profile: p, games }: { profile: TeamProfile; games: TeamGame[] }) {
  const [view, setView] = useState<TrendView>("margin");
  return (
    <Panel
      title="Game by game"
      subtitle="Points scored and allowed in every game played"
      delay={0.14}
      actions={<Segmented options={TREND_VIEWS} value={view} onChange={setView} label="Game by game view" />}
    >
      {view === "margin" && <MarginBars games={games} season={p.season} />}
      {view === "scores" && <ScoreLines games={games} season={p.season} />}
      {view === "table" && (
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="data-table">
            <caption className="sr-only">Scores by game</caption>
            <thead>
              <tr>
                <th scope="col">Week</th>
                <th scope="col" className="!text-left">
                  Opponent
                </th>
                <th scope="col">Scored</th>
                <th scope="col">Allowed</th>
                <th scope="col">Margin</th>
              </tr>
            </thead>
            <tbody>
              {games.map((g) => {
                const m = (g.points_for ?? 0) - (g.points_against ?? 0);
                return (
                  <tr key={g.game_id}>
                    <td className="font-semibold">{gameWeek(g, p.season)}</td>
                    <td className="!text-left">
                      <span className="inline-flex items-center gap-2">
                        <span className="w-5 text-muted">{g.is_home ? "vs" : "at"}</span>
                        <TeamMark abbr={g.opponent} size={12} />
                        {g.opponent}
                      </span>
                    </td>
                    <td>{g.points_for}</td>
                    <td>{g.points_against}</td>
                    <td className={m > 0 ? "font-bold text-[var(--tb)]" : "font-bold text-gray-300"}>{m === 0 ? "0" : signed(m, 0)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td />
                <td>{p.record.points_for}</td>
                <td>{p.record.points_against}</td>
                <td>{signed(p.record.points_for - p.record.points_against, 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Panel>
  );
}

/** Winning margins rise above the line in team colour; losses hang below in white stripes. */
function MarginBars({ games, season }: { games: TeamGame[]; season: number }) {
  const margins = games.map((g) => (g.points_for ?? 0) - (g.points_against ?? 0));
  const max = Math.max(7, ...margins.map(Math.abs));
  const up = Math.max(0, ...margins);
  const down = Math.max(0, ...margins.map((m) => -m));
  // Split the height between wins and losses in proportion to the biggest of each.
  const total = Math.max(1, up + down);
  const upShare = up === 0 ? 0.18 : down === 0 ? 0.82 : up / total;
  const H = 220;
  const top = Math.max(44, Math.round(H * upShare));
  const bottom = H - top;
  return (
    <div className="flex flex-col gap-2">
      <div
        role="img"
        aria-label={`Winning margin by game: ${games.map((g, i) => `${gameWeek(g, season)} ${margins[i] ?? 0}`).join(", ")}`}
        className="relative flex items-stretch gap-1 sm:gap-1.5"
        style={{ height: H }}
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 border-t border-white/25" style={{ top }} />
        {games.map((g, i) => {
          const m = margins[i] ?? 0;
          const h = (Math.abs(m) / max) * (m >= 0 ? top - 22 : bottom - 22);
          return (
            <div key={g.game_id} aria-hidden="true" className="relative flex min-w-0 flex-1 flex-col">
              <div className="relative flex flex-col justify-end" style={{ height: top }}>
                {m > 0 && (
                  <>
                    <span className="num mb-1 text-center text-[0.75rem] leading-none text-white sm:text-[0.95rem]">+{m}</span>
                    <div
                      className="grow-up mx-auto w-full max-w-10 rounded-t-[6px]"
                      style={{
                        height: h,
                        background: "linear-gradient(180deg, var(--tb), var(--tp))",
                        boxShadow: "0 0 18px -4px color-mix(in srgb, var(--tb) 80%, transparent)",
                        animationDelay: `${0.04 * i}s`,
                      }}
                    />
                  </>
                )}
                {m === 0 && <span className="num mb-1 text-center text-[0.95rem] leading-none text-muted">0</span>}
              </div>
              <div className="relative flex flex-col" style={{ height: bottom }}>
                {m < 0 && (
                  <>
                    <div
                      className="neg-stripes grow-up mx-auto w-full max-w-10 rounded-b-[6px] [transform-origin:top]"
                      style={{ height: h, animationDelay: `${0.04 * i}s` }}
                    />
                    <span className="num mt-1 text-center text-[0.75rem] leading-none text-gray-300 sm:text-[0.95rem]">−{-m}</span>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-1 sm:gap-1.5" aria-hidden="true">
        {games.map((g) => (
          <div key={g.game_id} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <TeamMark abbr={g.opponent} size={10} />
            <span className="truncate text-[0.625rem] font-bold text-faint">{g.game_type === "REG" ? g.week : "P"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Points scored (team colour) and allowed (white, dashed) as two lines. */
function ScoreLines({ games, season }: { games: TeamGame[]; season: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const H = 220;
  const pad = { l: 30, r: 12, t: 16, b: 26 };
  const w = Math.max(280, width);
  const max = Math.max(21, ...games.flatMap((g) => [g.points_for ?? 0, g.points_against ?? 0]));
  const yMax = Math.ceil(max / 7) * 7;
  const x = (i: number) => pad.l + (games.length === 1 ? (w - pad.l - pad.r) / 2 : (i * (w - pad.l - pad.r)) / (games.length - 1));
  const y = (v: number) => pad.t + (1 - v / yMax) * (H - pad.t - pad.b);
  const path = (key: "points_for" | "points_against") =>
    games.map((g, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(g[key] ?? 0).toFixed(1)}`).join(" ");
  const ticks = Array.from({ length: yMax / 7 + 1 }, (_, i) => i * 7).filter((v, _i, a) => a.length <= 7 || v % 14 === 0);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-4 text-xs font-semibold text-gray-300" aria-hidden="true">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-5 rounded" style={{ background: "var(--tb)" }} /> Scored
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0 w-5 border-t-2 border-dashed border-white/80" /> Allowed
        </span>
      </div>
      <div ref={ref}>
        {width > 0 && (
          <svg
            width={w}
            height={H}
            role="img"
            aria-label={`Points by game: ${games.map((g) => `${gameWeek(g, season)} ${g.points_for} to ${g.points_against}`).join(", ")}`}
          >
            {ticks.map((v) => (
              <g key={v}>
                <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.07)" />
                <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#9ca3af">
                  {v}
                </text>
              </g>
            ))}
            <path d={path("points_against")} fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2" strokeDasharray="5 5" />
            <path
              d={path("points_for")}
              fill="none"
              stroke="var(--tb)"
              strokeWidth="3"
              strokeLinejoin="round"
              style={{ filter: "drop-shadow(0 0 6px var(--tb))" }}
            />
            {games.map((g, i) => (
              <g key={g.game_id}>
                <circle cx={x(i)} cy={y(g.points_against ?? 0)} r="3" fill="#0b0b0c" stroke="#fff" strokeWidth="1.5" />
                <circle cx={x(i)} cy={y(g.points_for ?? 0)} r="4" fill={g.result === "W" ? "var(--tb)" : "#0b0b0c"} stroke="var(--tb)" strokeWidth="2" />
                <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="#6b7280">
                  {g.game_type === "REG" ? g.week : "P"}
                </text>
              </g>
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- ranks */

type Side = "offense" | "defense";
const SIDES: readonly Option<Side>[] = [
  { key: "offense", label: "Offense" },
  { key: "defense", label: "Defense" },
];
type RankView = "bars" | "table";
const RANK_VIEWS: readonly Option<RankView>[] = [
  { key: "bars", label: "Bars" },
  { key: "table", label: "Table" },
];

function rankValue(r: TeamRank, v: number | null = r.value): string {
  return statValue(r, v);
}

function rankTarget(r: TeamRank, abbr: string, season: number): PlaysTarget | null {
  return r.has_plays && r.value != null ? { subject: "team", team: abbr, stat: r.key, season } : null;
}

function Ranks({ ranks, team: abbr, season }: { ranks: TeamRank[]; team: string; season: number }) {
  const [side, setSide] = useState<Side>("offense");
  const [view, setView] = useState<RankView>("bars");
  const rows = ranks.filter((r) => r.side === side);
  const teams = rows.find((r) => r.teams)?.teams ?? 32;
  return (
    <Panel
      title="League ranks"
      subtitle={`Regular season, 1st is best of ${teams}`}
      delay={0.2}
      actions={<Segmented options={RANK_VIEWS} value={view} onChange={setView} label="Ranks view" />}
    >
      <ChipRow options={SIDES} value={side} onChange={setSide} label="Side of the ball" />
      {view === "bars" ? (
        <ul className="flex flex-col gap-3.5">
          {rows.map((r, i) => {
            const share = r.rank ? (r.teams - r.rank + 1) / r.teams : 0;
            const third = r.rank ? Math.ceil((r.rank / r.teams) * 3) : 3;
            return (
              <li key={r.key} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold text-gray-200">{r.label}</span>
                  <span className="flex items-baseline gap-2">
                    <StatTap target={rankTarget(r, abbr, season)} label={`${r.label}: see the plays`} className="num text-[1.35rem] leading-none text-white">
                      {rankValue(r)}
                    </StatTap>
                    <span className={`w-11 text-right text-xs font-extrabold ${third === 1 ? "text-[var(--tb)]" : "text-muted"}`}>
                      {r.rank ? ordinal(r.rank) : "–"}
                    </span>
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden="true">
                  <div
                    className={`grow-right h-full rounded-full ${third === 3 ? "neg-stripes" : ""}`}
                    style={{
                      width: `${Math.max(4, share * 100)}%`,
                      animationDelay: `${0.05 * i}s`,
                      ...(third === 1
                        ? { background: "linear-gradient(90deg, var(--tp), var(--tb))", boxShadow: "0 0 12px -2px var(--tb)" }
                        : third === 2
                          ? { background: "color-mix(in srgb, var(--tb) 45%, #2a2a2e)" }
                          : {}),
                    }}
                  />
                </div>
                <span className="text-[0.6875rem] text-faint">League average {rankValue(r, r.league_avg)}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <table className="data-table">
          <caption className="sr-only">{side === "offense" ? "Offense" : "Defense"} ranks</caption>
          <thead>
            <tr>
              <th scope="col">Stat</th>
              <th scope="col">Value</th>
              <th scope="col">Rank</th>
              <th scope="col">League avg</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="font-semibold">{r.label}</td>
                <td>
                  <StatTap target={rankTarget(r, abbr, season)} label={`${r.label}: see the plays`}>
                    {rankValue(r)}
                  </StatTap>
                </td>
                <td className="font-bold">{r.rank ? ordinal(r.rank) : "–"}</td>
                <td className="text-muted">{rankValue(r, r.league_avg)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-xs text-faint">
        Per play figures use scrimmage plays only (passes, sacks and runs). Success means the play gained enough yards to keep the drive on schedule.
      </p>
    </Panel>
  );
}

/* -------------------------------------------------------------- division */

type DivisionView = "table" | "bars";
const DIVISION_VIEWS: readonly Option<DivisionView>[] = [
  { key: "table", label: "Table" },
  { key: "bars", label: "Win %" },
];

function Division({ profile: p }: { profile: TeamProfile }) {
  const [view, setView] = useState<DivisionView>("table");
  return (
    <Panel
      title={p.info.division ?? "Division"}
      subtitle="By win percentage, then point difference"
      delay={0.24}
      actions={<Segmented options={DIVISION_VIEWS} value={view} onChange={setView} label="Division view" />}
    >
      {view === "table" ? (
        <StandingsTable rows={p.division} highlight={p.info.team} season={p.season} />
      ) : (
        <WinBars rows={p.division} highlight={p.info.team} season={p.season} />
      )}
    </Panel>
  );
}

function WinBars({ rows, highlight, season }: { rows: StandingRow[]; highlight: string; season: number }) {
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row, i) => {
        const r = row.record;
        const p = winPct(r.wins, r.losses, r.ties);
        const me = row.info.team === highlight;
        return (
          <li key={row.info.team} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <TeamLink abbr={row.info.team} season={season} className="inline-flex items-center gap-2 font-bold">
                <TeamMark abbr={row.info.team} size={13} />
                {team(row.info.team)?.short ?? row.info.name}
              </TeamLink>
              <span className="num text-[1.25rem] leading-none">
                {wlt(r.wins, r.losses, r.ties)} <span className="text-muted">{pctText(p)}</span>
              </span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden="true">
              <div
                className="grow-right h-full rounded-full"
                style={{
                  width: `${Math.max(3, p * 100)}%`,
                  animationDelay: `${0.06 * i}s`,
                  background: me
                    ? "linear-gradient(90deg, var(--tp), var(--tb))"
                    : `linear-gradient(90deg, ${alpha(bright(row.info.team), 0.35)}, ${alpha(bright(row.info.team), 0.75)})`,
                  boxShadow: me ? "0 0 14px -2px var(--tb)" : undefined,
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* -------------------------------------------------------------- injuries */

const STATUSES: InjuryStatus[] = ["Out", "Doubtful", "Questionable"];

function TeamInjuries({ profile: p }: { profile: TeamProfile }) {
  const [status, setStatus] = useState<"all" | InjuryStatus>("all");
  const options = [
    { key: "all" as const, label: `All ${p.injuries.length}` },
    ...STATUSES.map((s) => ({ key: s, label: `${s} ${p.injuries.filter((r) => r.status === s).length}` })),
  ];
  const rows = status === "all" ? p.injuries : p.injuries.filter((r) => r.status === status);
  return (
    <Panel title="Injury report" subtitle={p.injury_week ? `Week ${p.injury_week}` : undefined} delay={0.28}>
      <ChipRow options={options} value={status} onChange={setStatus} label="Injury status" />
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Nobody listed as {status.toLowerCase()} this week.</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((r) => (
            <li key={r.player_name} className="flex items-center gap-3 border-b border-white/[0.06] py-2.5 last:border-b-0">
              <span className="flex min-w-0 flex-1 flex-col">
                {r.player_id ? (
                  <Link to={`/players/${r.player_id}`} className="truncate font-bold hover:underline hover:underline-offset-4">
                    {r.player_name}
                  </Link>
                ) : (
                  <span className="truncate font-bold">{r.player_name}</span>
                )}
                <span className="truncate text-xs font-medium text-muted">
                  {[r.position, r.injury, r.practice_status].filter(Boolean).join(" · ")}
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
    </Panel>
  );
}

/* --------------------------------------------------------------- leaders */

type LeaderView = "cards" | "bars";
const LEADER_VIEWS: readonly Option<LeaderView>[] = [
  { key: "cards", label: "Cards" },
  { key: "bars", label: "Bars" },
];

function Leaders({ boards, team: abbr, season }: { boards: LeaderBoard[]; team: string; season: number }) {
  const [view, setView] = useState<LeaderView>("cards");
  const filled = boards.filter((b) => b.rows.length > 0);
  if (filled.length === 0) return null;
  return (
    <Panel
      title="Team leaders"
      subtitle="Regular season, with this team only"
      delay={0.32}
      actions={<Segmented options={LEADER_VIEWS} value={view} onChange={setView} label="Leaders view" />}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filled.map((b) => {
          const top = b.rows[0]?.value ?? 1;
          return (
            <section key={b.key} aria-label={b.label} className="flex flex-col gap-2.5 rounded-[18px] border border-[var(--color-line)] bg-white/[0.03] p-4">
              <h3 className="text-[0.6875rem] font-extrabold uppercase tracking-[0.1em] text-muted">{b.label}</h3>
              <ol className="flex flex-col gap-2.5">
                {b.rows.map((r, i) => (
                  <li key={r.player_id} className="flex flex-col gap-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="num w-4 text-[1.1rem] text-faint">{i + 1}</span>
                        <Link to={`/players/${r.player_id}?season=${season}`} className={`truncate font-bold hover:underline hover:underline-offset-4 ${i === 0 ? "text-white" : "text-gray-200"}`}>
                          {r.name}
                        </Link>
                        <span className="text-xs text-muted">{r.position}</span>
                      </span>
                      <StatTap
                        target={{ player: r.player_id, stat: b.key, season, team: abbr }}
                        label={`${r.name}, ${b.label} with ${abbr}: see the plays`}
                        className={`num leading-none ${i === 0 ? "text-[1.9rem] text-white" : "text-[1.35rem] text-gray-300"}`}
                      >
                        {num(r.value, b.decimals)}
                      </StatTap>
                    </span>
                    {view === "bars" && (
                      <span className="ml-6 h-2 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden="true">
                        <span
                          className="grow-right block h-full rounded-full"
                          style={{
                            width: `${Math.max(4, (r.value / top) * 100)}%`,
                            background: i === 0 ? "linear-gradient(90deg, var(--tp), var(--tb))" : "color-mix(in srgb, var(--tb) 40%, #2a2a2e)",
                            animationDelay: `${0.08 * i}s`,
                          }}
                        />
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
    </Panel>
  );
}
