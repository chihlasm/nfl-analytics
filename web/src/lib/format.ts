const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** 1730 -> "1,730"; with decimals, 4.5 -> "4.5". Null -> an en dash. */
export function num(value: number | null | undefined, decimals = 0): string {
  if (value == null || Number.isNaN(value)) return "–";
  if (decimals === 0) return whole.format(value);
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** 0.1384 -> "13.8%" */
export function pct(value: number | null | undefined, decimals = 1): string {
  if (value == null) return "–";
  return `${(value * 100).toFixed(decimals)}%`;
}

/** -0.0843 -> "−0.08" with a real minus sign; positive values get a "+". */
export function signed(value: number | null | undefined, decimals = 2): string {
  if (value == null) return "–";
  const text = Math.abs(value).toFixed(decimals);
  return value < 0 ? `−${text}` : `+${text}`;
}

/** "2026-11-15" -> "Sun, Nov 15". Date-only: no time-zone shift. */
export function shortDate(isoDate: string | null): string {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** "20:15" (Eastern) -> "8:15 PM ET" */
export function kickoff(time: string | null): string {
  if (!time) return "";
  const [h = 0, m = 0] = time.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix} ET`;
}

/** An ISO timestamp -> "12 min ago", "3 hr ago", "Yesterday", or "Nov 12". */
export function ago(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso);
  const minutes = Math.round((Date.now() - then.getTime()) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  if (hours < 48) return "Yesterday";
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** 75 -> "6′3″" */
export function height(inches: number | null): string | null {
  if (!inches) return null;
  return `${Math.floor(inches / 12)}′${inches % 12}″`;
}

/** A week label: regular season "Week 9", playoffs by round. */
export function weekLabel(week: number, seasonType = "REG", season?: number): string {
  if (seasonType !== "POST") return `Week ${week}`;
  // 17-game seasons (2021 on) end at week 18; earlier seasons at week 17.
  const first = season !== undefined && season < 2021 ? 18 : 19;
  const rounds = ["Wild Card", "Divisional", "Conference", "Super Bowl"];
  return rounds[week - first] ?? `Week ${week}`;
}
