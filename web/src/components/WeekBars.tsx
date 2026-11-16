import { useEffect, useId, useRef, useState } from "react";

import { num } from "../lib/format";

export interface Bar {
  label: string;
  /** Shown under the bar, e.g. the opponent. */
  sub?: string;
  value: number | null;
}

/**
 * A week-by-week bar chart drawn as plain SVG (no chart library, so nothing extra to
 * download). Every bar carries its value as text above it; the season average is a
 * dashed line. The same numbers are in the game log table for screen readers.
 */
/** Width of an element in CSS pixels, kept current as it resizes. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry?.contentRect.width ?? 0)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

const MIN_SLOT = 34; // narrowest a week can get before the chart scrolls sideways

export function WeekBars({ bars, decimals = 0, label }: { bars: Bar[]; decimals?: number; label: string }) {
  const id = useId();
  const [box, boxWidth] = useWidth<HTMLDivElement>();
  const values = bars.map((b) => b.value ?? 0);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const played = bars.filter((b) => b.value != null);
  const avg = played.length ? played.reduce((s, b) => s + (b.value ?? 0), 0) / played.length : null;

  // Fill the card; scroll sideways only when there are too many weeks to fit.
  const width = Math.max(boxWidth || 320, bars.length * MIN_SLOT);
  const height = 180;
  const top = 22;
  const bottom = 40;
  const plot = height - top - bottom;
  const span = max - min || 1;
  const y = (v: number) => top + ((max - v) / span) * plot;
  const zero = y(0);
  const slot = width / Math.max(bars.length, 1);
  const barW = Math.min(36, slot * 0.62);

  return (
    <figure className="flex flex-col gap-2">
      <div ref={box} className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          role="img"
          aria-labelledby={id}
          className="max-w-none"
        >
          <title id={id}>{label}</title>
          <line x1={0} x2={width} y1={zero} y2={zero} stroke="var(--color-line)" />
          {bars.map((b, i) => {
            const v = b.value ?? 0;
            const x = i * slot + (slot - barW) / 2;
            const yTop = Math.min(y(v), zero);
            const h = Math.max(Math.abs(zero - y(v)), b.value == null ? 0 : 2);
            return (
              <g key={`${b.label}-${i}`}>
                <rect x={x} y={yTop} width={barW} height={h} rx={5} fill="var(--color-bar)" />
                <text
                  x={x + barW / 2}
                  y={v >= 0 ? yTop - 6 : yTop + h + 14}
                  textAnchor="middle"
                  fontSize={11.5}
                  fill="var(--color-ink)"
                  className="figures"
                >
                  {b.value == null ? "" : num(b.value, decimals)}
                </text>
                <text x={x + barW / 2} y={height - 22} textAnchor="middle" fontSize={11.5} fill="var(--color-muted)">
                  {b.label}
                </text>
                {b.sub && (
                  <text x={x + barW / 2} y={height - 7} textAnchor="middle" fontSize={10.5} fill="var(--color-faint)">
                    {b.sub}
                  </text>
                )}
              </g>
            );
          })}
          {avg != null && (
            <line
              x1={0}
              x2={width}
              y1={y(avg)}
              y2={y(avg)}
              stroke="var(--color-muted)"
              strokeDasharray="4 4"
              strokeWidth={1}
            />
          )}
        </svg>
      </div>
      {avg != null && (
        <figcaption className="text-sm text-muted">
          Dashed line: average of <span className="figures">{num(avg, decimals || 1)}</span> per game
        </figcaption>
      )}
    </figure>
  );
}
