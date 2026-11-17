import { useId, useState } from "react";

import type { PlayerProfile, StatColumn, WeekLine } from "../lib/api";
import { num, pct, weekLabel } from "../lib/format";
import { useWidth } from "../lib/motion";
import { TeamLink, TeamMark } from "./TeamMark";
import { ChipRow, Panel, Segmented, type Option } from "./ui";

type View = "bars" | "line" | "table";
const VIEWS: readonly Option<View>[] = [
  { key: "bars", label: "Bars" },
  { key: "line", label: "Line" },
  { key: "table", label: "Table" },
];

/** Stats a chart can show, best first. `cmp_pct` is derived from completions/attempts. */
const CHARTABLE = [
  "passing_yards",
  "passing_tds",
  "passing_epa",
  "cmp_pct",
  "rushing_yards",
  "carries",
  "receiving_yards",
  "receptions",
  "targets",
  "def_tackles_solo",
  "def_sacks",
] as const;

interface Series {
  key: string;
  label: string;
  decimals: number;
  value: (w: WeekLine) => number | null;
  format: (v: number) => string;
}

function seriesFor(columns: StatColumn[]): Series[] {
  const byKey = new Map(columns.map((c) => [c.key, c]));
  // Lead with the position's main stat group (the API lists it first), e.g.
  // receiving before rushing for a WR. Completion % sits with passing.
  const groups = [...new Set(columns.map((c) => c.group))];
  const groupOf = (k: string) => groups.indexOf(k === "cmp_pct" ? "passing" : (byKey.get(k)?.group ?? ""));
  const ordered = [...CHARTABLE].sort((a, b) => groupOf(a) - groupOf(b) || CHARTABLE.indexOf(a) - CHARTABLE.indexOf(b));
  const out: Series[] = [];
  for (const key of ordered) {
    if (key === "cmp_pct") {
      if (byKey.has("completions") && byKey.has("attempts")) {
        out.push({
          key,
          label: "Completion %",
          decimals: 0,
          value: (w) => {
            const a = w.stats.attempts;
            return a ? ((w.stats.completions ?? 0) / a) * 100 : null;
          },
          format: (v) => `${Math.round(v)}%`,
        });
      }
      continue;
    }
    const c = byKey.get(key);
    if (!c) continue;
    out.push({
      key,
      label: c.label,
      decimals: c.decimals,
      value: (w) => w.stats[key] ?? null,
      format: (v) => (key.endsWith("_epa") ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}` : num(v, c.decimals)),
    });
  }
  return out.slice(0, 5);
}

/** A player's season, week by week: as bars, as a line, or as the full game log. */
export function SeasonChart({ profile }: { profile: PlayerProfile }) {
  const series = seriesFor(profile.columns);
  const [view, setView] = useState<View>("bars");
  const [key, setKey] = useState<string | undefined>(undefined);
  const s = series.find((x) => x.key === key) ?? series[0];
  if (!s || profile.weeks.length === 0) return null;

  const played = profile.weeks.map((w) => s.value(w)).filter((v): v is number => v != null);
  const avg = played.length ? played.reduce((a, b) => a + b, 0) / played.length : null;

  return (
    <Panel
      title="Week by week"
      delay={0.08}
      actions={<Segmented options={VIEWS} value={view} onChange={setView} label="Chart type" />}
    >
      {view !== "table" && (
        <div className="flex flex-wrap items-center gap-2">
          <ChipRow
            options={series.map((x) => ({ key: x.key, label: x.label }))}
            value={s.key}
            onChange={setKey}
            label="Stat to chart"
          />
          {avg != null && (
            <span className="ml-auto text-sm text-muted">
              Average <span className="num text-[1.4rem] text-white">{s.format(avg)}</span> per game
            </span>
          )}
        </div>
      )}
      {view === "table" ? (
        <GameLog profile={profile} />
      ) : (
        <WeekPlot weeks={profile.weeks} series={s} avg={avg} mode={view} season={profile.season} />
      )}
    </Panel>
  );
}

function WeekPlot({
  weeks,
  series,
  avg,
  mode,
  season,
}: {
  weeks: WeekLine[];
  series: Series;
  avg: number | null;
  mode: "bars" | "line";
  season: number | null;
}) {
  const ids = useId().replace(/:/g, "");
  const [box, boxWidth] = useWidth<HTMLDivElement>();
  const values = weeks.map((w) => series.value(w));
  const nums = values.map((v) => v ?? 0);
  const max = Math.max(...nums, 0);
  const min = Math.min(...nums, 0);
  const span = max - min || 1;
  const best = Math.max(...nums);

  const width = Math.max(boxWidth || 600, weeks.length * 40);
  const height = boxWidth && boxWidth < 520 ? 240 : 300;
  const top = 34;
  const bottom = 46;
  const plot = height - top - bottom;
  const y = (v: number) => top + ((max - v) / span) * plot;
  const zero = y(0);
  const slot = width / weeks.length;
  const barW = Math.min(64, slot * 0.62);
  const cx = (i: number) => i * slot + slot / 2;
  const pts = values.map((v, i) => `${cx(i).toFixed(1)},${y(v ?? 0).toFixed(1)}`);
  const label = `${series.label} by week, ${season ?? ""}`;

  return (
    <div ref={box} className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label} className="max-w-none overflow-visible">
        <defs>
          <linearGradient id={`${ids}bar`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: "var(--tb)" }} />
            <stop offset="0.75" style={{ stopColor: "var(--tp)" }} />
            <stop offset="1" style={{ stopColor: "color-mix(in srgb, var(--tp) 40%, transparent)" }} />
          </linearGradient>
          <linearGradient id={`${ids}best`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.2" style={{ stopColor: "var(--tb)" }} />
            <stop offset="1" style={{ stopColor: "var(--tp)" }} />
          </linearGradient>
          <linearGradient id={`${ids}line`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" style={{ stopColor: "var(--tb)" }} />
            <stop offset="1" style={{ stopColor: "var(--ts)" }} />
          </linearGradient>
          <linearGradient id={`${ids}area`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: "color-mix(in srgb, var(--tb) 42%, transparent)" }} />
            <stop offset="1" stopColor="rgba(0,0,0,0)" />
          </linearGradient>
          <pattern id={`${ids}neg`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="8" height="8" fill="rgba(255,255,255,0.12)" />
            <rect width="3" height="8" fill="rgba(255,255,255,0.55)" />
          </pattern>
        </defs>

        <line x1={0} x2={width} y1={zero} y2={zero} stroke="rgba(255,255,255,0.16)" />
        {avg != null && (
          <line x1={0} x2={width} y1={y(avg)} y2={y(avg)} stroke="rgba(255,255,255,0.4)" strokeDasharray="6 7" strokeWidth={1.5} />
        )}

        {mode === "bars" &&
          values.map((v, i) => {
            if (v == null) return null;
            const neg = v < 0;
            const isBest = v === best && v > 0;
            const yTop = Math.min(y(v), zero);
            const h = Math.max(Math.abs(zero - y(v)), 3);
            return (
              <rect
                key={i}
                className="grow-up"
                x={cx(i) - barW / 2}
                y={yTop}
                width={barW}
                height={h}
                rx={8}
                fill={neg ? `url(#${ids}neg)` : `url(#${ids}${isBest ? "best" : "bar"})`}
                stroke={neg ? "rgba(255,255,255,0.4)" : "none"}
                style={{
                  transformBox: "fill-box",
                  transformOrigin: neg ? "top" : "bottom",
                  animationDelay: `${i * 0.06}s`,
                  filter: neg ? undefined : `drop-shadow(0 0 ${isBest ? 14 : 8}px color-mix(in srgb, var(--tb) ${isBest ? 90 : 55}%, transparent))`,
                }}
              />
            );
          })}

        {mode === "line" && (
          <>
            <path
              d={`M${cx(0)},${zero} L${pts.join(" L")} L${cx(weeks.length - 1)},${zero} Z`}
              fill={`url(#${ids}area)`}
            />
            <polyline
              className="draw-line"
              points={pts.join(" ")}
              fill="none"
              stroke={`url(#${ids}line)`}
              strokeWidth={4.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              style={{ filter: "drop-shadow(0 0 10px color-mix(in srgb, var(--tb) 90%, transparent))" }}
            />
            {values.map((v, i) =>
              v == null ? null : (
                <g key={i}>
                  <circle className="pulse-soft" cx={cx(i)} cy={y(v)} r={12} style={{ fill: "color-mix(in srgb, var(--tb) 25%, transparent)" }} />
                  <circle cx={cx(i)} cy={y(v)} r={6.5} fill="#050505" strokeWidth={3.5} style={{ stroke: "var(--tb)" }} />
                </g>
              ),
            )}
          </>
        )}

        {values.map((v, i) => {
          if (v == null) return null;
          // Bars: the value sits above the bar, or just above the baseline for a
          // negative bar, so it never collides with the week labels underneath.
          const ly = mode === "line" ? y(v) - 16 : Math.min(y(v), zero) - 9;
          return (
            <text key={`v${i}`} x={cx(i)} y={ly} textAnchor="middle" className="num" fontSize={height < 280 ? 15 : 20} fill="#fff">
              {series.format(v)}
            </text>
          );
        })}

        {weeks.map((w, i) => (
          <g key={`x${i}`}>
            <text x={cx(i)} y={height - 24} textAnchor="middle" className="num" fontSize={14} fill="#e5e7eb">
              {w.season_type === "POST" ? weekLabel(w.week, "POST", season ?? undefined).split(" ")[0]?.toUpperCase() : `WK ${w.week}`}
            </text>
            <text x={cx(i)} y={height - 7} textAnchor="middle" fontSize={11.5} fontWeight={600} fill="#9ca3af">
              {w.opponent ?? ""}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

const GROUP_LABEL: Record<string, string> = {
  passing: "Passing",
  rushing: "Rushing",
  receiving: "Receiving",
  defense: "Defense",
};

function GroupHeader({ columns, lead }: { columns: StatColumn[]; lead: number }) {
  const spans: Array<{ group: string; span: number }> = [];
  for (const c of columns) {
    const last = spans.at(-1);
    if (last && last.group === c.group) last.span += 1;
    else spans.push({ group: c.group, span: 1 });
  }
  if (spans.length < 2) return null;
  return (
    <tr>
      <th colSpan={lead} aria-hidden="true" className="!border-b-0" />
      {spans.map((s, i) => (
        <th key={`${s.group}-${i}`} colSpan={s.span} scope="colgroup" className="!border-b-0 !text-left !text-[var(--tb)]">
          {GROUP_LABEL[s.group] ?? s.group}
        </th>
      ))}
    </tr>
  );
}

/** The full game log: every stat column for every week, season totals at the foot. */
export function GameLog({ profile }: { profile: PlayerProfile }) {
  const cols = profile.columns;
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
      <table className="data-table">
        <thead>
          <GroupHeader columns={cols} lead={3} />
          <tr>
            <th scope="col">Week</th>
            <th scope="col">Opp</th>
            <th scope="col" title="Share of the team's snaps played">
              Snaps
            </th>
            {cols.map((c) => (
              <th key={c.key} scope="col" title={c.label}>
                {c.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {profile.weeks.map((w) => (
            <tr key={`${w.season_type}-${w.week}`}>
              <td className="font-semibold">
                {weekLabel(w.week, w.season_type, profile.season ?? undefined)}
                {w.injury_status && (
                  <span className="ml-2 text-xs font-bold text-[var(--tb)]" title={`Injury report: ${w.injury_status}`}>
                    {w.injury_status[0]}
                  </span>
                )}
              </td>
              <td>
                <TeamLink abbr={w.opponent} season={profile.season ?? undefined} className="inline-flex items-center gap-1.5">
                  <TeamMark abbr={w.opponent} size={10} />
                  {w.opponent}
                </TeamLink>
              </td>
              <td>{w.snap_pct == null ? "–" : pct(w.snap_pct, 0)}</td>
              {cols.map((c) => (
                <td key={c.key}>{num(w.stats[c.key], c.decimals)}</td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Season</td>
            <td />
            <td />
            {cols.map((c) => (
              <td key={c.key}>{num(profile.totals[c.key], c.decimals)}</td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
