import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { Notice, Skeleton, errorText } from "../components/Notice";
import { DepthBars, ThrowMap } from "../components/QbPanels";
import { SeasonChart } from "../components/SeasonChart";
import { TeamLink, TeamMark } from "../components/TeamMark";
import { ChipRow, HeroFrame, Panel, Ring, Segmented, Stat, type Option } from "../components/ui";
import { ApiError, type MetricValue, type PlayerProfile, type StatColumn } from "../lib/api";
import { height, num, pct } from "../lib/format";
import { useCountUp } from "../lib/motion";
import { useScreenTeam } from "../lib/palette";
import { usePlayer } from "../lib/queries";
import { team } from "../lib/teams";

/** The season figures a player's hero leads with, in order of importance. */
const HEADLINE = [
  "passing_yards",
  "passing_tds",
  "passing_interceptions",
  "rushing_yards",
  "rushing_tds",
  "receptions",
  "receiving_yards",
  "receiving_tds",
  "targets",
  "carries",
  "def_tackles_solo",
  "def_sacks",
  "def_interceptions",
  "def_pass_defended",
];

/**
 * The stats to lead with. The API orders columns by the position's main stat group
 * first (receiving for a WR, rushing for a RB), so keep that group order and rank
 * within each group by HEADLINE.
 */
function headline(columns: StatColumn[], n = 4): StatColumn[] {
  const groups = [...new Set(columns.map((c) => c.group))];
  const rank = (k: string) => HEADLINE.indexOf(k);
  return columns
    .filter((c) => rank(c.key) >= 0)
    .sort((a, b) => groups.indexOf(a.group) - groups.indexOf(b.group) || rank(a.key) - rank(b.key))
    .slice(0, n);
}

/** The team a player was on in the season being shown (falls back to his current team). */
function seasonTeam(p: PlayerProfile): string | null {
  return p.weeks.find((w) => w.team)?.team ?? p.career.find((c) => c.season === p.season)?.team ?? p.player.team;
}

export function Player() {
  const { id } = useParams();
  const [season, setSeason] = useState<number | undefined>(undefined);
  const player = usePlayer(id, season);
  const p = player.data;
  useScreenTeam(p ? seasonTeam(p) : null);

  if (player.isPending) {
    return (
      <div className="flex flex-col gap-5">
        <div className="h-[22rem] animate-pulse rounded-[26px] bg-white/[0.05]" aria-hidden="true" />
        <Skeleton rows={2} className="h-64" />
      </div>
    );
  }
  if (player.error || !p) {
    const missing = player.error instanceof ApiError && player.error.status === 404;
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <Notice tone="alert">{missing ? "We couldn't find that player." : errorText(player.error)}</Notice>
      </div>
    );
  }

  const behindLos = p.depth.find((d) => d.depth === "behind_los")?.attempts;

  return (
    <div className={`flex flex-col gap-5 transition-opacity ${player.isPlaceholderData ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackLink />
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

      {p.columns.length === 0 ? (
        <Notice>We don't track box-score stats for this position yet.</Notice>
      ) : p.season == null ? (
        <Notice>No games on record for this player since 1999.</Notice>
      ) : (
        <>
          <SeasonChart key={`${p.player.player_id}-${p.season}`} profile={p} />
          {p.throw_map.length > 0 && (
            <div className="grid gap-5 lg:grid-cols-2">
              <ThrowMap cells={p.throw_map} behindLos={behindLos} />
              <DepthBars lines={p.depth} />
            </div>
          )}
          {p.career.length > 0 && <Career profile={p} />}
          {p.metrics.length > 0 && <p className="text-xs text-faint">Accuracy figures: charting by FTN Data via nflverse.</p>}
        </>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/players" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
      <ArrowLeft size={16} aria-hidden="true" />
      Players
    </Link>
  );
}

function splitName(name: string): [string, string] {
  const parts = name.split(" ");
  if (parts.length < 2) return [name, ""];
  return [parts[0] ?? "", parts.slice(1).join(" ")];
}

function surname(name: string): string {
  const words = name.replace(/\b(Jr\.?|Sr\.?|II|III|IV)$/i, "").trim().split(" ");
  return (words.at(-1) ?? name).toUpperCase();
}

function Hero({ profile }: { profile: PlayerProfile }) {
  const { player } = profile;
  const abbr = seasonTeam(profile);
  const t = useCountUp(`${player.player_id}-${profile.season}`);
  const [first, rest] = splitName(player.display_name);
  const stats = headline(profile.columns);
  const bio = [
    profile.years_of_experience != null ? `${profile.years_of_experience} yrs in the league` : null,
    profile.college,
    [height(profile.height_in), profile.weight_lb ? `${profile.weight_lb} lb` : null].filter(Boolean).join(", ") || null,
    profile.draft ? `Drafted ${profile.draft}` : null,
  ].filter(Boolean);

  const cmp = profile.totals.completions;
  const att = profile.totals.attempts;
  const tiles: Array<{ label: string; value: string }> = stats.slice(0, att ? 3 : 4).map((c) => ({
    label: c.label,
    value: num((profile.totals[c.key] ?? 0) * t, c.decimals),
  }));
  if (att) tiles.push({ label: "Completion", value: `${(((cmp ?? 0) / att) * 100 * t).toFixed(1)}%` });

  const rings = qbRings(profile.metrics);

  return (
    <HeroFrame watermark={surname(player.display_name)} emblem={abbr}>
      <div className={`grid gap-7 ${rings.length ? "lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]" : ""}`}>
        <div className="flex flex-col gap-3.5">
          <div className="flex items-center gap-2.5">
            <TeamMark abbr={abbr} size={16} />
            <span className="text-[0.8125rem] font-extrabold uppercase tracking-[0.12em] text-[var(--tb)]">
              {player.position}
              {abbr && (
                <>
                  {" · "}
                  <TeamLink abbr={abbr} season={profile.season ?? undefined}>
                    {team(abbr)?.name ?? abbr}
                  </TeamLink>
                </>
              )}
            </span>
          </div>
          <h1 className="disp text-[3.75rem] leading-[0.86] text-white sm:text-[6rem]">
            {first}
            <br />
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage: "linear-gradient(90deg, #fff 10%, var(--tb) 55%, var(--ts))",
                filter: "drop-shadow(0 0 22px color-mix(in srgb, var(--tb) 45%, transparent))",
              }}
            >
              {rest}
            </span>
          </h1>
          {bio.length > 0 && <p className="text-sm font-medium text-gray-300">{bio.join(" · ")}</p>}
          {profile.season != null && tiles.length > 0 && (
            <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-2.5">
              {tiles.map((tile, i) => (
                <Stat key={tile.label} value={tile.value} label={tile.label} accent={i === 0} />
              ))}
            </div>
          )}
        </div>
        {rings.length > 0 && (
          <div className="grid grid-cols-3 gap-2 self-center sm:gap-3">
            {rings.map((r, i) => (
              <Ring key={r.label} {...r} delay={0.25 + i * 0.15} size={88} />
            ))}
          </div>
        )}
      </div>
    </HeroFrame>
  );
}

/** The three QB accuracy rings, from the saved metrics (empty for other positions). */
function qbRings(metrics: MetricValue[]) {
  const m = new Map(metrics.map((x) => [x.name, x]));
  const out: Array<{ share: number; value: string; label: string; sub?: string; from?: string; to?: string }> = [];
  const catchable = m.get("catchable_ball_rate");
  if (catchable?.value != null) {
    out.push({
      share: catchable.value,
      value: pct(catchable.value),
      label: "Catchable",
      sub: catchable.denominator != null ? `${catchable.numerator} of ${catchable.denominator}` : undefined,
    });
  }
  const misses = m.get("short_throw_misses");
  const rate = m.get("short_throw_miss_rate");
  if (misses?.value != null) {
    out.push({
      share: rate?.value ?? 0,
      value: num(misses.value),
      label: "Short misses",
      sub: rate?.value != null ? `${pct(rate.value)} of short throws` : undefined,
      from: "#ffffff",
      to: "var(--tb)",
    });
  }
  const epa = m.get("epa_per_dropback");
  if (epa?.value != null) {
    out.push({
      share: (epa.value + 0.5) / 1,
      value: `${epa.value > 0 ? "+" : epa.value < 0 ? "−" : ""}${Math.abs(epa.value).toFixed(2)}`,
      label: "EPA / dropback",
      sub: "Ring spans −0.5 to +0.5",
      from: "var(--ts)",
      to: "var(--tp)",
    });
  }
  return out;
}

type CareerView = "total" | "game";
const CAREER_VIEWS: readonly Option<CareerView>[] = [
  { key: "total", label: "Totals" },
  { key: "game", label: "Per game" },
];

function Career({ profile }: { profile: PlayerProfile }) {
  const [view, setView] = useState<CareerView>("total");
  const cols = headline(profile.columns, 3);
  const att = profile.columns.some((c) => c.key === "attempts");
  return (
    <Panel
      title="Career"
      subtitle="Regular season, by year"
      delay={0.26}
      actions={<Segmented options={CAREER_VIEWS} value={view} onChange={setView} label="Career view" />}
    >
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {profile.career.map((s) => {
          const current = s.season === profile.season;
          const cmpRate = att && s.stats.attempts ? (s.stats.completions ?? 0) / s.stats.attempts : null;
          return (
            <li
              key={s.season}
              className="flex flex-col gap-3 rounded-[18px] p-4"
              style={
                current
                  ? {
                      background:
                        "linear-gradient(150deg, color-mix(in srgb, var(--tp) 55%, transparent), color-mix(in srgb, var(--td) 60%, transparent) 70%)",
                      border: "1px solid color-mix(in srgb, var(--tb) 60%, transparent)",
                      boxShadow: "0 0 34px -10px color-mix(in srgb, var(--tb) 80%, transparent)",
                    }
                  : { background: "rgba(255,255,255,0.03)", border: "1px solid var(--color-line)" }
              }
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="num text-[2rem] leading-none">{s.season}</span>
                <span className="flex items-center gap-2 text-xs font-semibold text-muted">
                  <TeamLink abbr={s.team} season={s.season} className="inline-flex items-center gap-2">
                    <TeamMark abbr={s.team} size={10} />
                    {s.team}
                  </TeamLink>
                  · {s.games} games
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {cols.map((c) => {
                  const v = s.stats[c.key];
                  const shown = view === "game" && v != null && s.games ? num(v / s.games, c.key.endsWith("_tds") || c.key.includes("interceptions") ? 2 : 1) : num(v, c.decimals);
                  return (
                    <div key={c.key} className="flex flex-col">
                      <span className="num text-[1.75rem] leading-none">{shown}</span>
                      <span className="mt-1 text-[0.625rem] font-extrabold uppercase tracking-[0.06em] text-muted">{c.label}</span>
                    </div>
                  );
                })}
              </div>
              {cmpRate != null && (
                <>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                    <div className="h-full" style={{ width: `${cmpRate * 100}%`, background: "linear-gradient(90deg, var(--tp), var(--tb))" }} />
                  </div>
                  <span className="text-xs font-semibold text-muted">{pct(cmpRate)} completion</span>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
