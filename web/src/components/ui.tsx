/**
 * Small shared pieces for the team-adaptive design: panels, view switchers, rings
 * and the spinning hero frame. Colours come from the screen's --tp/--tb/--ts vars.
 */
import { useId, type ReactNode } from "react";

/** A glass panel with a broadcast-style title and optional controls on the right. */
export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = "",
  delay = 0,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={title ? id : undefined}
      className={`panel rise flex min-w-0 flex-col gap-4 p-4 sm:p-5 ${className}`}
      style={{ animationDelay: `${delay}s` }}
    >
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            {title && (
              <h2 id={id} className="disp text-[1.75rem] sm:text-[2rem]">
                {title}
              </h2>
            )}
            {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export interface Option<K extends string> {
  key: K;
  label: string;
}

/** A segmented switch between views ("Bars / Line / Table"). */
export function Segmented<K extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly Option<K>[];
  value: K;
  onChange: (key: K) => void;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" className="pill" aria-pressed={o.key === value} onClick={() => onChange(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A row of chips that picks one option (which stat, which status). */
export function ChipRow<K extends string>({
  options,
  value,
  onChange,
  label,
  wrap = false,
}: {
  options: readonly (Option<K> & { extra?: ReactNode })[];
  value: K;
  onChange: (key: K) => void;
  label: string;
  wrap?: boolean;
}) {
  return (
    <div className={wrap ? "flex flex-wrap gap-1.5" : "scroll-row -mx-1 px-1"} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" className="pill" aria-pressed={o.key === value} onClick={() => onChange(o.key)}>
          {o.label}
          {o.extra}
        </button>
      ))}
    </div>
  );
}

/** An animated progress ring with a big figure in the middle. `share` is 0-1. */
export function Ring({
  share,
  value,
  label,
  sub,
  from = "var(--tb)",
  to = "var(--ts)",
  size = 112,
  delay = 0,
}: {
  share: number;
  value: string;
  label: string;
  sub?: string;
  from?: string;
  to?: string;
  size?: number;
  delay?: number;
}) {
  const id = useId();
  const pct = Math.max(0, Math.min(1, share)) * 100;
  return (
    <div className="flex flex-col items-center gap-2 rounded-[18px] border border-[var(--color-line)] bg-black/40 px-2 py-4 text-center">
      <svg width={size} height={size} viewBox="0 0 42 42" role="img" aria-label={`${label}: ${value}${sub ? `, ${sub}` : ""}`}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={from} />
            <stop offset="1" stopColor={to} />
          </linearGradient>
        </defs>
        <circle cx="21" cy="21" r="15.915" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3.8" />
        <circle
          className="ring-in"
          cx="21"
          cy="21"
          r="15.915"
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth="3.8"
          strokeLinecap="round"
          strokeDasharray={`${pct} ${100 - pct}`}
          strokeDashoffset="25"
          style={{ filter: `drop-shadow(0 0 4px ${from})`, animationDelay: `${delay}s` }}
        />
        <text x="21" y="24.4" textAnchor="middle" className="num" fontSize="10" fill="#fff">
          {value}
        </text>
      </svg>
      <span className="text-[0.6875rem] font-extrabold uppercase tracking-[0.06em] text-ink">{label}</span>
      {sub && <span className="text-xs text-muted">{sub}</span>}
    </div>
  );
}

/**
 * The hero card: a light that circles the border, diagonal stripes, a giant outlined
 * word in the background and a periodic light sweep. All decoration is aria-hidden.
 */
export function HeroFrame({ watermark, children }: { watermark?: string; children: ReactNode }) {
  return (
    <div className="rise relative overflow-hidden rounded-[26px] bg-white/10 p-[2px]">
      <div
        aria-hidden="true"
        className="spin-slow absolute left-1/2 top-1/2 aspect-square w-[260%] -translate-x-1/2 -translate-y-1/2 sm:w-[200%]"
        style={{
          background:
            "conic-gradient(from 0deg, transparent 0deg, var(--tb) 40deg, var(--ts) 70deg, transparent 110deg, transparent 360deg)",
        }}
      />
      <section
        className="relative overflow-hidden rounded-[24px] p-5 sm:p-8"
        style={{
          background:
            "linear-gradient(120deg, color-mix(in srgb, var(--tp) 62%, transparent), color-mix(in srgb, var(--td) 92%, transparent) 52%, #070707)",
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ background: "repeating-linear-gradient(115deg, rgba(255,255,255,0.035) 0 2px, transparent 2px 22px)" }}
        />
        {watermark && (
          <div
            aria-hidden="true"
            className="disp pointer-events-none absolute -bottom-10 -right-6 whitespace-nowrap text-[11rem] text-transparent sm:-bottom-16 sm:text-[18rem]"
            style={{ WebkitTextStroke: "2px color-mix(in srgb, var(--tb) 24%, transparent)" }}
          >
            {watermark}
          </div>
        )}
        <div
          aria-hidden="true"
          className="sweep pointer-events-none absolute inset-y-0 left-0 w-1/4"
          style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.09), transparent)" }}
        />
        <div className="relative">{children}</div>
      </section>
    </div>
  );
}

/** A big figure with a small caps label under it. */
export function Stat({ value, label, accent = false }: { value: ReactNode; label: ReactNode; accent?: boolean }) {
  return (
    <div
      className="flex flex-col gap-1.5 rounded-[14px] bg-black/40 px-4 py-3"
      style={{ border: `1px solid ${accent ? "color-mix(in srgb, var(--tb) 55%, transparent)" : "var(--color-line)"}` }}
    >
      <span className="num text-[2.4rem] leading-none text-white sm:text-[3rem]">{value}</span>
      <span className="text-[0.6875rem] font-extrabold uppercase tracking-[0.08em] text-muted">{label}</span>
    </div>
  );
}
