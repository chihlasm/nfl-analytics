/**
 * Small shared pieces for the team-adaptive design: panels, view switchers, rings
 * and the spinning hero frame. Colours come from the screen's --tp/--tb/--ts vars.
 */
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

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

/**
 * A row of chips that picks one option (which season, which status).
 * Long rows scroll sideways: by swipe, trackpad, mouse wheel, or the arrow
 * buttons that appear on devices with a mouse. Faded edges show there is more,
 * and the chosen chip scrolls into view.
 */
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
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || wrap) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    // A vertical mouse wheel scrolls the row sideways, but only while the row
    // can still move that way, so the page scrolls normally at either end.
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      const next = el.scrollLeft + e.deltaY;
      if ((e.deltaY < 0 && el.scrollLeft <= 0) || (e.deltaY > 0 && el.scrollLeft >= max)) return;
      e.preventDefault();
      el.scrollLeft = Math.max(0, Math.min(max, next));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      el.removeEventListener("wheel", onWheel);
    };
  }, [measure, wrap, options.length]);

  // Keep the chosen chip visible (an older season picked from a link, say).
  useEffect(() => {
    const el = ref.current;
    const chip = el?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!el || !chip || wrap) return;
    const box = el.getBoundingClientRect();
    const c = chip.getBoundingClientRect();
    // Only move when the chip is cut off; then centre it.
    if (c.left < box.left || c.right > box.right) {
      const target = el.scrollLeft + (c.left - box.left) - (box.width - c.width) / 2;
      el.scrollTo({ left: Math.max(0, target), behavior: "instant" as ScrollBehavior });
    }
    measure();
  }, [value, wrap, measure, options.length]);

  const page = (dir: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: reduce ? "auto" : "smooth" });
  };

  if (wrap) {
    return (
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.key} type="button" className="pill" aria-pressed={o.key === value} onClick={() => onChange(o.key)}>
            {o.label}
            {o.extra}
          </button>
        ))}
      </div>
    );
  }

  const mask =
    edges.left && edges.right
      ? "linear-gradient(90deg, transparent, #000 2.5rem, #000 calc(100% - 2.5rem), transparent)"
      : edges.left
        ? "linear-gradient(90deg, transparent, #000 2.5rem)"
        : edges.right
          ? "linear-gradient(90deg, #000 calc(100% - 2.5rem), transparent)"
          : undefined;

  return (
    <div className="chip-row relative min-w-0">
      <div
        ref={ref}
        onScroll={measure}
        className="scroll-row -mx-3 -my-3 scroll-px-3 px-3 py-3"
        role="group"
        aria-label={label}
        style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      >
        {options.map((o) => (
          <button key={o.key} type="button" className="pill shrink-0" aria-pressed={o.key === value} onClick={() => onChange(o.key)}>
            {o.label}
            {o.extra}
          </button>
        ))}
      </div>
      {edges.left && (
        <button type="button" className="chip-arrow left-0" aria-label="Scroll left" tabIndex={-1} onClick={() => page(-1)}>
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
      )}
      {edges.right && (
        <button type="button" className="chip-arrow right-0" aria-label="Scroll right" tabIndex={-1} onClick={() => page(1)}>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export interface SelectGroup<K extends string> {
  label: string;
  options: readonly Option<K>[];
}

/**
 * A dropdown that looks like the rest of the app but is the browser's own
 * select underneath: phones open their native picker, keyboards and screen
 * readers work out of the box. `prefix` sits inside the button ("Stat").
 */
export function Select<K extends string>({
  value,
  onChange,
  label,
  groups,
  options,
  prefix,
  className = "",
}: {
  value: K;
  onChange: (key: K) => void;
  label: string;
  groups?: readonly SelectGroup<K>[];
  options?: readonly Option<K>[];
  prefix?: string;
  className?: string;
}) {
  const id = useId();
  const all = groups ? groups.flatMap((g) => g.options) : (options ?? []);
  const current = all.find((o) => o.key === value)?.label ?? "";
  return (
    <div className={`select-pill relative inline-flex min-w-0 ${className}`}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <span aria-hidden="true" className="pointer-events-none flex min-w-0 items-center gap-2 pl-4 pr-10">
        {prefix && <span className="shrink-0 text-xs font-semibold text-muted">{prefix}</span>}
        <span className="truncate font-bold text-white">{current}</span>
      </span>
      <ChevronDown size={17} aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--tb)]" />
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as K)}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
      >
        {groups
          ? groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))
          : all.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
      </select>
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
export function HeroFrame({
  watermark,
  emblem,
  children,
}: {
  watermark?: string;
  /** A team code: its logo sits large and faded behind the top-right corner. */
  emblem?: string | null;
  children: ReactNode;
}) {
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
        {emblem && (
          <img
            src={`/api/teams/${encodeURIComponent(emblem)}/logo`}
            alt=""
            aria-hidden="true"
            className="hero-emblem pointer-events-none absolute -right-10 -top-12 w-56 select-none sm:-right-6 sm:-top-16 sm:w-80"
            onError={(e) => {
              e.currentTarget.hidden = true;
            }}
          />
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
