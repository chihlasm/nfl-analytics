import { useState } from "react";

import type { DepthLine, Direction, ThrowCell } from "../lib/api";
import { num } from "../lib/format";
import { Panel, Segmented, type Option } from "./ui";

type MapMetric = "cmp" | "epa" | "att";
const METRICS: readonly Option<MapMetric>[] = [
  { key: "cmp", label: "Completion %" },
  { key: "epa", label: "EPA" },
  { key: "att", label: "Attempts" },
];

const ROWS: Array<{ depth: ThrowCell["depth"]; label: string; range: string }> = [
  { depth: "deep", label: "Deep", range: "20+ yds" },
  { depth: "intermediate", label: "Mid", range: "10–19 yds" },
  { depth: "short", label: "Short", range: "0–9 yds" },
];
const COLS: Direction[] = ["left", "middle", "right"];

function signed(v: number, d = 2) {
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}`;
}

/**
 * Where a quarterback throws, as a 3x3 heat grid (depth by direction), coloured by
 * completion %, EPA per attempt or volume. Brighter = better; cells that lost
 * expected points are white stripes.
 */
export function ThrowMap({ cells, behindLos }: { cells: ThrowCell[]; behindLos?: number }) {
  const [metric, setMetric] = useState<MapMetric>("cmp");
  const byKey = new Map(cells.map((c) => [`${c.depth}-${c.direction}`, c]));
  const maxAtt = Math.max(...cells.map((c) => c.attempts), 1);

  const heat = (c: ThrowCell) => {
    if (metric === "att") return c.attempts / maxAtt;
    if (metric === "cmp") return ((c.completion_rate ?? 0) * 100 - 25) / 55;
    return ((c.epa_per_attempt ?? 0) + 0.8) / 1.6;
  };
  const shown = (c: ThrowCell) =>
    metric === "att"
      ? String(c.attempts)
      : metric === "cmp"
        ? c.completion_rate == null
          ? "–"
          : `${Math.round(c.completion_rate * 100)}%`
        : c.epa_per_attempt == null
          ? "–"
          : signed(c.epa_per_attempt);

  return (
    <Panel
      title="Throw map"
      subtitle="Depth by direction. Brighter means better."
      delay={0.14}
      actions={<Segmented options={METRICS} value={metric} onChange={setMetric} label="Map colour" />}
    >
      <table className="w-full border-separate [border-spacing:6px] sm:[border-spacing:8px]">
        <caption className="sr-only">Throws by depth and direction</caption>
        <thead>
          <tr>
            <td />
            {COLS.map((d) => (
              <th key={d} scope="col" className="num text-[0.95rem] uppercase text-muted">
                {d === "middle" ? "Mid" : d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.depth}>
              <th scope="row" className="w-14 text-left sm:w-24">
                <span className="num block text-[1.1rem] uppercase text-ink sm:text-[1.25rem]">{r.label}</span>
                <span className="hidden text-xs font-normal text-faint sm:block">{r.range}</span>
              </th>
              {COLS.map((dir) => {
                const c = byKey.get(`${r.depth}-${dir}`);
                if (!c) {
                  return (
                    <td key={dir} className="h-16 rounded-[12px] border border-dashed border-white/10 text-center text-faint sm:h-24">
                      –
                    </td>
                  );
                }
                const h = Math.max(0.05, Math.min(1, heat(c)));
                const lost = metric === "epa" && (c.epa_per_attempt ?? 0) < 0;
                return (
                  <td
                    key={dir}
                    className={`h-16 rounded-[12px] text-center text-white sm:h-24 ${lost ? "neg-stripes !border-dashed" : ""}`}
                    style={
                      lost
                        ? undefined
                        : {
                            background: `radial-gradient(120% 120% at 30% 20%, color-mix(in srgb, var(--tb) ${Math.round(20 + h * 75)}%, transparent), color-mix(in srgb, var(--tp) ${Math.round(15 + h * 60)}%, transparent))`,
                            border: `1px solid color-mix(in srgb, var(--tb) ${Math.round(25 + h * 60)}%, transparent)`,
                            boxShadow: `0 0 ${Math.round(h * 34)}px -6px color-mix(in srgb, var(--tb) 90%, transparent)`,
                            textShadow: "0 1px 8px rgba(0,0,0,0.5)",
                          }
                    }
                  >
                    <span className="num block text-[1.5rem] leading-none sm:text-[2rem]">{shown(c)}</span>
                    <span className="mt-1 hidden text-xs font-semibold opacity-85 sm:block">
                      {metric === "att" ? `${Math.round((c.completion_rate ?? 0) * 100)}% complete` : `${c.attempts} attempts`}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-faint">
        {behindLos ? `${behindLos} throws behind the line of scrimmage not shown. ` : ""}Regular season only.
      </p>
    </Panel>
  );
}

const DEPTH_LABEL: Record<DepthLine["depth"], [string, string]> = {
  behind_los: ["Behind LOS", "screens and swings"],
  short: ["Short", "0–9 yds"],
  intermediate: ["Mid", "10–19 yds"],
  deep: ["Deep", "20+ yds"],
};

/** Every attempt at each depth, split into complete / his miss / other incompletion. */
export function DepthBars({ lines }: { lines: DepthLine[] }) {
  const charted = lines.some((l) => l.misses != null);
  return (
    <Panel
      title="Accuracy by depth"
      subtitle={charted ? "Every attempt: complete, his miss, or other incompletion" : "Completions at each depth"}
      delay={0.2}
    >
      <ul className="flex flex-col gap-5">
        {lines.map((l) => {
          const [label, range] = DEPTH_LABEL[l.depth];
          const misses = l.misses ?? 0;
          const cmpPct = l.attempts ? (l.completions / l.attempts) * 100 : 0;
          const missPct = l.attempts ? (misses / l.attempts) * 100 : 0;
          return (
            <li key={l.depth} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <span className="num text-[1.25rem] uppercase">
                  {label} <span className="text-xs font-medium normal-case not-italic text-faint">{range}</span>
                </span>
                <span className="text-sm font-semibold text-muted">{num(l.attempts)} att</span>
              </div>
              <div className="flex h-[18px] gap-0.5 overflow-hidden rounded-md bg-white/[0.05]">
                <div
                  className="grow-right rounded-[4px]"
                  title="Complete"
                  style={{
                    width: `${cmpPct}%`,
                    background: "linear-gradient(90deg, var(--tp), var(--tb))",
                    boxShadow: "0 0 16px color-mix(in srgb, var(--tb) 60%, transparent)",
                  }}
                />
                {charted && <div className="grow-right neg-stripes rounded-[4px] !border-0" title="His miss" style={{ width: `${missPct}%` }} />}
                <div className="flex-1 rounded-[4px] bg-white/[0.14]" title="Other incompletion" />
              </div>
              <div className="flex gap-4 text-sm text-muted">
                <span>
                  <span className="num text-[1.15rem] text-[var(--tb)]">{Math.round(cmpPct)}%</span> complete
                </span>
                {charted && (
                  <span>
                    <span className="num text-[1.15rem] text-white">{misses}</span> his misses
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-4 text-xs font-semibold text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-[3px]" style={{ background: "linear-gradient(90deg, var(--tp), var(--tb))" }} />
          Complete
        </span>
        {charted && (
          <span className="flex items-center gap-1.5">
            <span className="neg-stripes h-3 w-3 rounded-[3px] !border-0" />
            His miss (uncatchable)
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-[3px] bg-white/[0.14]" />
          Other
        </span>
      </div>
    </Panel>
  );
}
