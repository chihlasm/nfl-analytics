import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { Notice, Skeleton, errorText } from "../components/Notice";
import { StatTap } from "../components/StatTap";
import { TeamLink, TeamMark } from "../components/TeamMark";
import { ChipRow, Panel, Segmented, type Option } from "../components/ui";
import {
  ApiError,
  type Game,
  type GameDetail,
  type GamePlay,
  type GamePreview,
  type GameRecap,
  type GameStat,
  type InjuryRow,
  type LeaderBoard,
  type MatchupRow,
  type PlayerGroup,
  type WinPoint,
} from "../lib/api";
import { kickoff, num, ordinal, shortDate, weekLabel, wlt } from "../lib/format";
import { useWidth } from "../lib/motion";
import { alpha, useScreenTeam } from "../lib/palette";
import type { PlaysTarget } from "../lib/plays";
import { useGame } from "../lib/queries";
import { statValue } from "../lib/stats";
import { team } from "../lib/teams";

type Side = "away" | "home";

function teamName(abbr: string): string {
  return team(abbr)?.name ?? abbr;
}

function short(abbr: string): string {
  return team(abbr)?.short ?? abbr;
}

function bright(abbr: string): string {
  return team(abbr)?.bright ?? "#9ca3af";
}

function primary(abbr: string): string {
  return team(abbr)?.primary ?? "#374151";
}

function seasonType(g: Game): "REG" | "POST" {
  return g.game_type === "REG" ? "REG" : "POST";
}

export function GamePage() {
  const { gameId } = useParams();
  const query = useGame(gameId);
  const d = query.data;
  // The page wears the home team's colours; the away team's show where its numbers are.
  useScreenTeam(d?.game.home.team ?? null);

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-5">
        <div className="h-72 animate-pulse rounded-[26px] bg-white/[0.05]" aria-hidden="true" />
        <Skeleton rows={3} className="h-56" />
      </div>
    );
  }
  if (query.error || !d) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <Notice tone="alert">{missing ? "We couldn't find that game. Open it from the scores on the home page." : errorText(query.error)}</Notice>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <BackLink />
      <Hero detail={d} />
      {d.recap ? <Recap game={d.game} recap={d.recap} /> : d.preview ? <Preview game={d.game} preview={d.preview} /> : null}
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/" className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-muted hover:text-ink">
      <ArrowLeft size={16} aria-hidden="true" />
      Scores
    </Link>
  );
}

/* ----------------------------------------------------------------- hero */

function statusText(d: GameDetail): string {
  const g = d.game;
  if (g.live?.state === "in") return g.live.detail;
  if (g.is_final) return g.is_overtime ? "Final/OT" : "Final";
  return `${shortDate(g.game_date)} · ${kickoff(g.kickoff_time_et)}`;
}

function lineResult(g: Game): string | null {
  if (g.spread_line == null) return null;
  // nflverse's spread_line is the home team's expected margin (positive: home favoured).
  const fav = g.spread_line > 0 ? g.home.team : g.spread_line < 0 ? g.away.team : null;
  const line = fav ? `${fav} by ${Math.abs(g.spread_line)}` : "Pick'em";
  const total = g.total_line != null ? ` · O/U ${g.total_line}` : "";
  if (!g.is_final || g.home.score == null || g.away.score == null) return `${line}${total}`;
  const margin = g.home.score - g.away.score;
  const ats = margin === g.spread_line ? "push" : margin > g.spread_line ? `${g.home.team} covered` : `${g.away.team} covered`;
  const points = g.home.score + g.away.score;
  const ou = g.total_line == null ? "" : points === g.total_line ? " · total pushed" : points > g.total_line ? " · went over" : " · stayed under";
  return `${line}${total} — ${ats}${ou}`;
}

function Hero({ detail: d }: { detail: GameDetail }) {
  const g = d.game;
  const live = g.live?.state === "in" ? g.live : null;
  const played = g.is_final || live !== null;
  const winner = g.is_final && g.home.score != null && g.away.score != null ? (g.home.score > g.away.score ? "home" : g.away.score > g.home.score ? "away" : null) : null;
  const p = d.preview;
  const weather = [
    d.info.stadium,
    d.info.roof && d.info.roof !== "outdoors" ? d.info.roof : null,
    d.info.temp_f != null ? `${Math.round(d.info.temp_f)}°F` : null,
    d.info.wind_mph != null ? `wind ${Math.round(d.info.wind_mph)} mph` : null,
    d.info.referee ? `referee ${d.info.referee}` : null,
  ].filter(Boolean);
  const line = lineResult(g);

  const side = (s: Side) => {
    const abbr = g[s].team;
    const record = s === "away" ? p?.away_record : p?.home_record;
    const form = s === "away" ? p?.away_form : p?.home_form;
    return (
      <div className={`flex min-w-0 flex-1 flex-col gap-2 ${s === "home" ? "items-end text-right" : ""}`}>
        <TeamLink abbr={abbr} season={g.season} className={`flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 ${s === "home" ? "items-end sm:flex-row-reverse" : "items-start"}`}>
          <TeamMark abbr={abbr} size={34} />
          <span className="flex min-w-0 flex-col">
            <span className="text-xs font-bold uppercase tracking-[0.12em] text-gray-300">{s === "away" ? "Away" : "Home"}</span>
            <span className="disp text-[1.75rem] leading-none text-white sm:hidden">{abbr}</span>
            <span className="disp hidden truncate leading-none text-white sm:block sm:text-[2.4rem] lg:text-[3rem]">{short(abbr)}</span>
          </span>
        </TeamLink>
        {record && <span className="text-sm font-semibold text-gray-300">{wlt(record.wins, record.losses, record.ties)}{record.streak ? ` · ${record.streak}` : ""}</span>}
        {form && form.length > 0 && (
          <span className={`flex gap-1 ${s === "home" ? "flex-row-reverse" : ""}`} aria-label={`Last ${form.length}: ${form.join(", ")}`}>
            {form.map((r, i) => (
              <span key={i} aria-hidden="true" className={`grid h-6 w-6 place-items-center rounded-full text-[0.6875rem] font-extrabold ${r === "W" ? "bg-white text-black" : "border border-white/30 text-gray-300"}`}>
                {r}
              </span>
            ))}
          </span>
        )}
      </div>
    );
  };

  return (
    <section
      aria-label={`${teamName(g.away.team)} at ${teamName(g.home.team)}`}
      className="relative overflow-hidden rounded-[26px] border border-white/[0.1] p-5 sm:p-8"
      style={{
        background: `linear-gradient(105deg, ${alpha(primary(g.away.team), 0.85)} 0%, #09090b 42%, #09090b 58%, ${alpha(primary(g.home.team), 0.85)} 100%)`,
      }}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: "repeating-linear-gradient(115deg, rgba(255,255,255,0.035) 0 2px, transparent 2px 18px)" }} />
      <div className="relative flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-center gap-2 text-center text-xs font-extrabold uppercase tracking-[0.12em] text-gray-300">
          <span>{weekLabel(g.week, seasonType(g), g.season)}, {g.season}</span>
          {d.info.is_division_game && <span className="rounded-full bg-white/10 px-2 py-0.5">Division game</span>}
          {live ? (
            <span className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-white" style={{ background: "var(--tb)" }}>
              <span className="live-dot" aria-hidden="true" /> Live · {live.detail}
            </span>
          ) : (
            <span className={g.is_final ? "text-white" : "text-[var(--tb)]"}>{statusText(d)}</span>
          )}
        </div>
        <div className="flex items-center gap-3 sm:gap-6">
          {side("away")}
          <div className="flex shrink-0 items-center gap-2 sm:gap-4">
            {played ? (
              <>
                <span className={`num text-[2.75rem] leading-none sm:text-[4.5rem] lg:text-[5.5rem] ${winner === "home" ? "text-white/45" : "text-white"}`}>{g.away.score ?? 0}</span>
                <span className="text-xl text-white/30">–</span>
                <span className={`num text-[2.75rem] leading-none sm:text-[4.5rem] lg:text-[5.5rem] ${winner === "away" ? "text-white/45" : "text-white"}`}>{g.home.score ?? 0}</span>
              </>
            ) : (
              <span className="disp text-[1.75rem] text-white/70 sm:text-[3.5rem]">at</span>
            )}
          </div>
          {side("home")}
        </div>
        {live && (live.down_distance || live.last_play) && (
          <p className="text-center text-sm text-gray-200">
            {live.possession && <TeamMark abbr={live.possession} size={11} />} {live.down_distance}
            {live.red_zone && " · red zone"}
            {live.last_play && <span className="block text-xs text-gray-400">{live.last_play}</span>}
          </p>
        )}
        <div className="flex flex-col items-center gap-1 text-center text-xs text-gray-300">
          {line && <span className="font-semibold">{line}</span>}
          {weather.length > 0 && <span className="text-gray-400">{weather.join(" · ")}</span>}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- recap */

function Recap({ game, recap }: { game: Game; recap: GameRecap }) {
  return (
    <>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Quarters game={game} recap={recap} />
        <WinProbability game={game} points={recap.win_probability} />
      </div>
      <TeamStats game={game} stats={recap.team_stats} />
      <PlaysPanel game={game} recap={recap} />
      <Players game={game} groups={recap.players} />
    </>
  );
}

function Quarters({ game, recap }: { game: Game; recap: GameRecap }) {
  const total = (s: Side) => recap.quarters.reduce((n, q) => n + q[s], 0);
  return (
    <Panel title="Scoring" subtitle="Points by quarter" delay={0.04}>
      <div className="-mx-4 overflow-x-auto sm:mx-0">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col" className="!text-left">
                Team
              </th>
              {recap.quarters.map((q) => (
                <th key={q.label} scope="col">
                  {q.label}
                </th>
              ))}
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {(["away", "home"] as const).map((s) => (
              <tr key={s}>
                <td className="!text-left">
                  <span className="inline-flex items-center gap-2 font-bold">
                    <TeamMark abbr={game[s].team} size={13} />
                    {short(game[s].team)}
                  </span>
                </td>
                {recap.quarters.map((q) => (
                  <td key={q.label} className={q[s] > 0 ? "text-white" : "text-muted"}>
                    {q[s]}
                  </td>
                ))}
                <td className="num text-[1.3rem] text-white">{total(s)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** Home win probability across the game: the line leans toward whoever is ahead. */
function WinProbability({ game, points }: { game: Game; points: WinPoint[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  if (points.length < 2) return null;
  const H = 210;
  const pad = { l: 8, r: 8, t: 14, b: 22 };
  const w = Math.max(280, width);
  const end = Math.max(3600, points[points.length - 1]?.t ?? 3600);
  const x = (t: number) => pad.l + (t / end) * (w - pad.l - pad.r);
  const y = (p: number) => pad.t + (1 - p) * (H - pad.t - pad.b);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.home_wp).toFixed(1)}`).join(" ");
  const mid = y(0.5);
  const area = `${line} L${x(points[points.length - 1]!.t).toFixed(1)},${mid} L${x(points[0]!.t).toFixed(1)},${mid} Z`;
  const away = bright(game.away.team);
  const home = bright(game.home.team);
  const quarters = Array.from({ length: Math.ceil(end / 900) + 1 }, (_, i) => i * 900).filter((t) => t <= end);
  const last = points[points.length - 1]!;
  return (
    <Panel title="Win probability" subtitle={`${short(game.home.team)} above the line, ${short(game.away.team)} below`} delay={0.08}>
      <div ref={ref}>
        {width > 0 && (
          <svg width={w} height={H} role="img" aria-label={`Win probability chart. ${short(game.home.team)} finished at ${Math.round(last.home_wp * 100)} percent.`}>
            <defs>
              <clipPath id="wp-top">
                <rect x={0} y={0} width={w} height={mid} />
              </clipPath>
              <clipPath id="wp-bottom">
                <rect x={0} y={mid} width={w} height={H - mid} />
              </clipPath>
            </defs>
            {quarters.map((t, i) => (
              <g key={t}>
                <line x1={x(t)} x2={x(t)} y1={pad.t} y2={H - pad.b} stroke="rgba(255,255,255,0.07)" />
                {i > 0 && (
                  <text x={x(t - 450)} y={H - 6} textAnchor="middle" fontSize="11" fill="#6b7280">
                    {i <= 4 ? `Q${i}` : "OT"}
                  </text>
                )}
              </g>
            ))}
            <line x1={pad.l} x2={w - pad.r} y1={mid} y2={mid} stroke="rgba(255,255,255,0.3)" strokeDasharray="4 4" />
            <path d={area} fill={alpha(home, 0.32)} clipPath="url(#wp-top)" />
            <path d={area} fill={alpha(away, 0.32)} clipPath="url(#wp-bottom)" />
            <path d={line} fill="none" stroke={home} strokeWidth="2.5" clipPath="url(#wp-top)" />
            <path d={line} fill="none" stroke={away} strokeWidth="2.5" clipPath="url(#wp-bottom)" />
            <text x={pad.l + 4} y={pad.t + 12} fontSize="11" fontWeight="700" fill={home}>
              {short(game.home.team)} 100%
            </text>
            <text x={pad.l + 4} y={H - pad.b - 6} fontSize="11" fontWeight="700" fill={away}>
              {short(game.away.team)} 100%
            </text>
          </svg>
        )}
      </div>
    </Panel>
  );
}

type StatView = "bars" | "table";
const STAT_VIEWS: readonly Option<StatView>[] = [
  { key: "bars", label: "Bars" },
  { key: "table", label: "Table" },
];
const STAT_GROUPS: readonly Option<"box" | "advanced">[] = [
  { key: "box", label: "Box score" },
  { key: "advanced", label: "Advanced" },
];

function statText(s: GameStat, side: Side): string {
  const text = side === "away" ? s.away_text : s.home_text;
  if (text) return text;
  return statValue(s, side === "away" ? s.away : s.home);
}

function teamTarget(game: Game, s: GameStat, side: Side): PlaysTarget | null {
  if (!s.has_plays || (side === "away" ? s.away : s.home) == null) return null;
  return { subject: "team", team: game[side].team, stat: s.key, season: game.season, season_type: seasonType(game), week: game.week };
}

function TeamStats({ game, stats }: { game: Game; stats: GameStat[] }) {
  const [view, setView] = useState<StatView>("bars");
  const [group, setGroup] = useState<"box" | "advanced">("box");
  const rows = stats.filter((s) => s.group === group);
  const edges = (side: Side) => stats.filter((s) => s.edge === side).length;
  return (
    <Panel
      title="Team stats"
      subtitle={`${short(game.away.team)} won ${edges("away")} categories, ${short(game.home.team)} won ${edges("home")}`}
      delay={0.12}
      actions={<Segmented options={STAT_VIEWS} value={view} onChange={setView} label="Team stats view" />}
    >
      <ChipRow options={STAT_GROUPS} value={group} onChange={setGroup} label="Which stats" />
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm font-bold">
        <span className="flex items-center gap-2">
          <TeamMark abbr={game.away.team} size={13} />
          {short(game.away.team)}
        </span>
        <span />
        <span className="flex items-center justify-end gap-2">
          {short(game.home.team)}
          <TeamMark abbr={game.home.team} size={13} />
        </span>
      </div>
      {view === "bars" ? (
        <ul className="flex flex-col gap-4">
          {rows.map((s, i) => (
            <StatBar key={s.key} game={game} stat={s} index={i} />
          ))}
        </ul>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">{game.away.team}</th>
              <th scope="col" className="!text-center">
                Stat
              </th>
              <th scope="col">{game.home.team}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.key}>
                <td className={s.edge === "away" ? "font-bold text-white" : ""}>
                  <StatTap target={teamTarget(game, s, "away")} label={`${teamName(game.away.team)} ${s.label}: see the plays`}>
                    {statText(s, "away")}
                  </StatTap>
                </td>
                <td className="!text-center text-gray-300">{s.label}</td>
                <td className={s.edge === "home" ? "font-bold text-white" : ""}>
                  <StatTap target={teamTarget(game, s, "home")} label={`${teamName(game.home.team)} ${s.label}: see the plays`}>
                    {statText(s, "home")}
                  </StatTap>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-xs text-faint">Bold marks the better side. Tap an underlined number to see its plays.</p>
    </Panel>
  );
}

/** Two bars meeting in the middle: each team's share, the better side lit up. */
function StatBar({ game, stat: s, index }: { game: Game; stat: GameStat; index: number }) {
  const a = s.away ?? 0;
  const h = s.home ?? 0;
  const signed = s.unit === "epa";
  const scale = Math.max(Math.abs(a), Math.abs(h), 1e-9);
  const share = (v: number) => (signed ? Math.abs(v) / scale : v / scale);
  const bar = (side: Side) => {
    const v = side === "away" ? a : h;
    const lit = s.edge === side;
    const c = bright(game[side].team);
    return (
      <span className={`flex h-3 overflow-hidden rounded-full bg-white/[0.06] ${side === "away" ? "justify-end" : ""}`} aria-hidden="true">
        <span
          className={`grow-right block h-full rounded-full ${signed && v < 0 ? "neg-stripes" : ""} ${side === "away" ? "[transform-origin:right]" : ""}`}
          style={{
            width: `${Math.max(3, share(v) * 100)}%`,
            animationDelay: `${index * 0.03}s`,
            ...(signed && v < 0 ? {} : { background: lit ? `linear-gradient(90deg, ${alpha(c, 0.7)}, ${c})` : alpha(c, 0.35), boxShadow: lit ? `0 0 12px -2px ${c}` : undefined }),
          }}
        />
      </span>
    );
  };
  return (
    <li className="flex flex-col gap-1.5">
      <div className="grid grid-cols-[1fr_auto_1fr] items-baseline gap-3">
        <StatTap target={teamTarget(game, s, "away")} label={`${teamName(game.away.team)} ${s.label}: see the plays`} className={`num justify-self-start text-[1.35rem] leading-none ${s.edge === "away" ? "text-white" : "text-gray-400"}`}>
          {statText(s, "away")}
        </StatTap>
        <span className="text-center text-xs font-semibold text-gray-300">{s.label}</span>
        <StatTap target={teamTarget(game, s, "home")} label={`${teamName(game.home.team)} ${s.label}: see the plays`} className={`num justify-self-end text-[1.35rem] leading-none ${s.edge === "home" ? "text-white" : "text-gray-400"}`}>
          {statText(s, "home")}
        </StatTap>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {bar("away")}
        {bar("home")}
      </div>
    </li>
  );
}

type PlaysView = "swings" | "scoring";
const PLAYS_VIEWS: readonly Option<PlaysView>[] = [
  { key: "swings", label: "Biggest swings" },
  { key: "scoring", label: "Scoring plays" },
];

function PlaysPanel({ game, recap }: { game: Game; recap: GameRecap }) {
  const [view, setView] = useState<PlaysView>("swings");
  const plays = view === "swings" ? recap.key_plays : recap.scoring_plays;
  return (
    <Panel
      title="Key plays"
      subtitle={view === "swings" ? "The plays that moved win probability the most" : "Every score, with the score after the try"}
      delay={0.16}
      actions={<Segmented options={PLAYS_VIEWS} value={view} onChange={setView} label="Which plays" />}
    >
      {plays.length === 0 ? (
        <p className="text-sm text-muted">No plays to show.</p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {plays.map((p) => (
            <li key={p.play_id}>
              <KeyPlay game={game} play={p} showScore={view === "scoring"} />
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function KeyPlay({ game, play: p, showScore }: { game: Game; play: GamePlay; showScore: boolean }) {
  const offense = p.team ?? game.home.team;
  // Whose win probability went up, and by how much.
  const change = p.home_wp_change;
  const gainer = change == null ? null : change >= 0 ? game.home.team : game.away.team;
  const c = bright(offense);
  return (
    <article className="flex flex-col gap-2 rounded-[16px] border border-white/[0.08] p-3.5" style={{ background: `linear-gradient(110deg, ${alpha(c, 0.18)}, #0d0d10 55%)` }}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold">
        <span className="flex items-center gap-2 text-gray-200">
          <TeamMark abbr={offense} size={12} />
          {short(offense)} ball · {p.qtr ? (p.qtr > 4 ? "OT" : `Q${p.qtr}`) : ""} {p.clock}
          {p.kind && <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] uppercase tracking-[0.06em] ${p.kind === "TD" ? "bg-white text-black" : "bg-white/10 text-gray-200"}`}>{p.kind}</span>}
        </span>
        {showScore && p.away_score != null ? (
          <span className="num text-[1.2rem] leading-none text-white">
            {game.away.team} {p.away_score} · {game.home.team} {p.home_score}
          </span>
        ) : gainer && change != null ? (
          <span className="num text-[1.2rem] leading-none" style={{ color: bright(gainer) }}>
            +{Math.round(Math.abs(change) * 100)}% {short(gainer)}
          </span>
        ) : null}
      </div>
      {p.description && <p className="text-sm leading-relaxed text-gray-200">{p.description}</p>}
    </article>
  );
}

function Players({ game, groups }: { game: Game; groups: PlayerGroup[] }) {
  const [side, setSide] = useState<Side>("away");
  const options: Option<Side>[] = [
    { key: "away", label: short(game.away.team) },
    { key: "home", label: short(game.home.team) },
  ];
  const shown = groups.filter((g) => g[side].length > 0);
  return (
    <Panel title="Player stats" subtitle="Tap a number to see that player's plays from this game" delay={0.2} actions={<Segmented options={options} value={side} onChange={setSide} label="Team" />}>
      {shown.length === 0 ? (
        <p className="text-sm text-muted">No player stats for this team yet.</p>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {shown.map((g) => (
            <section key={g.key} aria-label={g.label} className="flex flex-col gap-2">
              <h3 className="disp text-[1.4rem]">{g.label}</h3>
              <div className="-mx-4 overflow-x-auto sm:mx-0">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col" className="!text-left">
                        Player
                      </th>
                      {g.columns.map((c) => (
                        <th key={c.key} scope="col" title={c.label}>
                          {c.short}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {g[side].map((p) => (
                      <tr key={p.player_id}>
                        <td className="!text-left">
                          <Link to={`/players/${p.player_id}?season=${game.season}`} className="font-bold hover:underline hover:underline-offset-4">
                            {p.name}
                          </Link>
                          {p.position && <span className="ml-1.5 text-xs text-muted">{p.position}</span>}
                        </td>
                        {g.columns.map((c) => {
                          const v = p.stats[c.key] ?? 0;
                          return (
                            <td key={c.key}>
                              <StatTap
                                target={v ? { player: p.player_id, stat: c.key, season: game.season, season_type: seasonType(game), week: game.week, team: game[side].team } : null}
                                label={`${p.name}, ${c.label}: see the plays`}
                              >
                                {statValue(c, v)}
                              </StatTap>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------- preview */

type MatchupView = "away" | "home" | "side";

function Preview({ game, preview: p }: { game: Game; preview: GamePreview }) {
  const all = [...p.away_offense, ...p.home_offense];
  const edges = (s: Side) => all.filter((r) => r.edge === s).length;
  const a = edges("away");
  const h = edges("home");
  const leader = a === h ? null : a > h ? game.away.team : game.home.team;
  return (
    <>
      <Panel delay={0.04}>
        <div className="flex flex-col items-center gap-2 text-center sm:flex-row sm:justify-between sm:text-left">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-extrabold uppercase tracking-[0.12em] text-muted">Statistical edge</span>
            <span className="disp text-[2rem] leading-none text-white sm:text-[2.6rem]">
              {leader ? `${short(leader)} lead ${Math.max(a, h)} of ${all.length}` : `Even at ${a} each`}
            </span>
            <span className="text-sm text-gray-300">Each offense against the other defense, compared by league rank.</span>
          </div>
          <EdgeMeter game={game} away={a} home={h} />
        </div>
        {p.stats_note && <Notice>{p.stats_note}</Notice>}
      </Panel>
      <Matchups game={game} preview={p} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Meetings game={game} preview={p} />
        <KeyPlayers preview={p} />
      </div>
      {(p.away_injuries.length > 0 || p.home_injuries.length > 0) && <Injuries game={game} preview={p} />}
    </>
  );
}

function EdgeMeter({ game, away, home }: { game: Game; away: number; home: number }) {
  const total = Math.max(1, away + home);
  return (
    <div className="flex w-full max-w-sm flex-col gap-1.5" aria-label={`${short(game.away.team)} ${away}, ${short(game.home.team)} ${home}`}>
      <div className="flex justify-between text-sm font-bold">
        <span className="flex items-center gap-1.5">
          <TeamMark abbr={game.away.team} size={13} /> {away}
        </span>
        <span className="flex items-center gap-1.5">
          {home} <TeamMark abbr={game.home.team} size={13} />
        </span>
      </div>
      <div className="flex h-3.5 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden="true">
        <span className="grow-right h-full" style={{ width: `${(away / total) * 100}%`, background: `linear-gradient(90deg, ${primary(game.away.team)}, ${bright(game.away.team)})` }} />
        <span className="h-full flex-1" style={{ background: `linear-gradient(90deg, ${bright(game.home.team)}, ${primary(game.home.team)})` }} />
      </div>
    </div>
  );
}

function Matchups({ game, preview: p }: { game: Game; preview: GamePreview }) {
  const [view, setView] = useState<MatchupView>("away");
  const [show, setShow] = useState<"ranks" | "values">("ranks");
  const options: Option<MatchupView>[] = [
    { key: "away", label: `${short(game.away.team)} ball` },
    { key: "home", label: `${short(game.home.team)} ball` },
    { key: "side", label: "Side by side" },
  ];
  const rows = view === "away" ? p.away_offense : view === "home" ? p.home_offense : p.side_by_side;
  const caption =
    view === "away"
      ? `${teamName(game.away.team)} offense against the ${teamName(game.home.team)} defense`
      : view === "home"
        ? `${teamName(game.home.team)} offense against the ${teamName(game.away.team)} defense`
        : "The same stat for both teams";
  return (
    <Panel
      title="Matchups"
      subtitle={`${caption} · ${p.stats_season} regular season`}
      delay={0.08}
      actions={
        <Segmented
          options={[
            { key: "ranks", label: "Ranks" },
            { key: "values", label: "Values" },
          ]}
          value={show}
          onChange={setShow}
          label="Show ranks or values"
        />
      }
    >
      <ChipRow options={options} value={view} onChange={setView} label="Which matchup" />
      <ul className="flex flex-col gap-3.5">
        {rows.map((r, i) => (
          <MatchupLine key={`${view}-${r.label}`} game={game} row={r} show={show} index={i} />
        ))}
      </ul>
      <p className="text-xs text-faint">Ranks are out of {rows[0]?.teams ?? 32} teams, 1st is best. The edge goes to the better rank.</p>
    </Panel>
  );
}

function MatchupLine({ game, row: r, show, index }: { game: Game; row: MatchupRow; show: "ranks" | "values"; index: number }) {
  const cell = (side: Side) => {
    const rank = side === "away" ? r.away_rank : r.home_rank;
    const value = side === "away" ? r.away_value : r.home_value;
    const lit = r.edge === side;
    const big = show === "ranks" ? (rank ? ordinal(rank) : "–") : statValue(r, value);
    const small = show === "ranks" ? statValue(r, value) : rank ? ordinal(rank) : "";
    return (
      <span className={`flex flex-col ${side === "home" ? "items-end text-right" : ""}`}>
        <span className={`num text-[1.45rem] leading-none ${lit ? "text-white" : "text-gray-400"}`} style={lit ? { textShadow: `0 0 16px ${alpha(bright(game[side].team), 0.8)}` } : undefined}>
          {big}
        </span>
        <span className="text-[0.6875rem] text-muted">{small}</span>
      </span>
    );
  };
  const strength = (rank: number | null) => (rank ? (r.teams - rank + 1) / r.teams : 0);
  return (
    <li className="flex flex-col gap-1.5">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        {cell("away")}
        <span className="flex flex-col items-center text-center">
          <span className="text-xs font-semibold text-gray-200">{r.label}</span>
          {r.edge && (
            <span className="mt-0.5 flex items-center gap-1 text-[0.625rem] font-extrabold uppercase tracking-[0.08em]" style={{ color: bright(game[r.edge].team) }}>
              <TeamMark abbr={game[r.edge].team} size={9} /> edge
            </span>
          )}
        </span>
        {cell("home")}
      </div>
      <div className="grid grid-cols-2 gap-1.5" aria-hidden="true">
        {(["away", "home"] as const).map((side) => {
          const c = bright(game[side].team);
          const lit = r.edge === side;
          return (
            <span key={side} className={`flex h-2.5 overflow-hidden rounded-full bg-white/[0.06] ${side === "away" ? "justify-end" : ""}`}>
              <span
                className={`grow-right block h-full rounded-full ${side === "away" ? "[transform-origin:right]" : ""}`}
                style={{
                  width: `${Math.max(3, strength(side === "away" ? r.away_rank : r.home_rank) * 100)}%`,
                  animationDelay: `${index * 0.03}s`,
                  background: lit ? `linear-gradient(90deg, ${alpha(c, 0.7)}, ${c})` : alpha(c, 0.3),
                }}
              />
            </span>
          );
        })}
      </div>
    </li>
  );
}

function Meetings({ game, preview: p }: { game: Game; preview: GamePreview }) {
  const wins = (abbr: string) => p.meetings.filter((m) => m.winner === abbr).length;
  return (
    <Panel title="Past meetings" subtitle={p.meetings.length ? `${short(game.away.team)} ${wins(game.away.team)}, ${short(game.home.team)} ${wins(game.home.team)} in the last ${p.meetings.length}` : "These teams haven't met since 1999"} delay={0.12}>
      {p.meetings.length > 0 && (
        <ol className="flex flex-col gap-2">
          {p.meetings.map((m) => {
            const host = m.home;
            const guest = host === game.home.team ? game.away.team : game.home.team;
            return (
              <li key={m.game_id}>
                <Link to={`/games/${m.game_id}`} className="flex items-center justify-between gap-3 rounded-[12px] border border-white/[0.07] px-3 py-2.5 hover:border-[var(--tb)]">
                  <span className="text-xs font-bold text-muted">
                    {m.season} · {weekLabel(m.week, m.game_type === "REG" ? "REG" : "POST", m.season)}
                  </span>
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <TeamMark abbr={guest} size={11} />
                    <span className={m.winner === guest ? "text-white" : "text-gray-400"}>
                      {guest} {m.away_score}
                    </span>
                    <span className="text-muted">at</span>
                    <TeamMark abbr={host} size={11} />
                    <span className={m.winner === host ? "text-white" : "text-gray-400"}>
                      {host} {m.home_score}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

function KeyPlayers({ preview: p }: { preview: GamePreview }) {
  const keys = ["passing_yards", "rushing_yards", "receiving_yards", "def_sacks"];
  const top = (boards: LeaderBoard[], key: string) => boards.find((b) => b.key === key);
  return (
    <Panel title="Key players" subtitle={`Team leaders, ${p.stats_season} regular season`} delay={0.16}>
      <ul className="flex flex-col gap-3">
        {keys.map((key) => {
          const a = top(p.away_leaders, key);
          const h = top(p.home_leaders, key);
          const label = a?.label ?? h?.label ?? key;
          const ar = a?.rows[0];
          const hr = h?.rows[0];
          return (
            <li key={key} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              <span className="flex min-w-0 flex-col">
                {ar ? (
                  <>
                    <Link to={`/players/${ar.player_id}`} className="truncate text-sm font-bold hover:underline">
                      {ar.name}
                    </Link>
                    <span className="num text-[1.2rem] leading-none text-white">{num(ar.value, a?.decimals ?? 0)}</span>
                  </>
                ) : (
                  <span className="text-muted">–</span>
                )}
              </span>
              <span className="text-center text-xs font-semibold text-gray-300">{label}</span>
              <span className="flex min-w-0 flex-col items-end text-right">
                {hr ? (
                  <>
                    <Link to={`/players/${hr.player_id}`} className="truncate text-sm font-bold hover:underline">
                      {hr.name}
                    </Link>
                    <span className="num text-[1.2rem] leading-none text-white">{num(hr.value, h?.decimals ?? 0)}</span>
                  </>
                ) : (
                  <span className="text-muted">–</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function Injuries({ game, preview: p }: { game: Game; preview: GamePreview }) {
  const list = (rows: InjuryRow[]) =>
    rows.length === 0 ? (
      <p className="text-sm text-muted">Nobody listed.</p>
    ) : (
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li key={r.player_name} className="flex items-center justify-between gap-2 border-b border-white/[0.06] py-2 last:border-b-0">
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-bold">{r.player_name}</span>
              <span className="truncate text-xs text-muted">{[r.position, r.injury].filter(Boolean).join(" · ")}</span>
            </span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[0.625rem] font-extrabold uppercase tracking-[0.06em] ${r.status === "Out" ? "bg-white text-black" : "bg-white/10 text-gray-200"}`}>{r.status}</span>
          </li>
        ))}
      </ul>
    );
  return (
    <Panel title="Injury report" subtitle={p.injury_week ? `Week ${p.injury_week}` : undefined} delay={0.2}>
      <div className="grid gap-5 sm:grid-cols-2">
        {(["away", "home"] as const).map((s) => (
          <section key={s} aria-label={teamName(game[s].team)} className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 font-bold">
              <TeamMark abbr={game[s].team} size={13} /> {teamName(game[s].team)}
            </h3>
            {list(s === "away" ? p.away_injuries : p.home_injuries)}
          </section>
        ))}
      </div>
    </Panel>
  );
}
