import type { SelectGroup } from "../components/ui";
import type { StatGroup, StatInfo } from "./api";

export const GROUP_LABELS: Record<StatGroup, string> = {
  passing: "Passing",
  rushing: "Rushing",
  receiving: "Receiving",
  defense: "Defense",
  advanced: "Advanced",
};

/** A stat's value as people read it: 13.8% for rates, +0.214 for EPA, 1,207 for counts. */
export function statValue(stat: Pick<StatInfo, "unit" | "decimals">, value: number | null | undefined, perGame = false): string {
  if (value == null || Number.isNaN(value)) return "–";
  if (stat.unit === "rate") return `${(value * 100).toFixed(1)}%`;
  const decimals = perGame ? Math.max(1, stat.decimals) : stat.decimals;
  if (stat.unit === "epa") {
    const text = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    return `${value > 0 ? "+" : value < 0 ? "−" : ""}${text}`;
  }
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** The catalog as dropdown groups: Passing, Rushing, Receiving, Defense. */
export function statGroups(stats: readonly StatInfo[]): SelectGroup<string>[] {
  return (Object.keys(GROUP_LABELS) as StatGroup[])
    .map((g) => ({
      label: GROUP_LABELS[g],
      options: stats.filter((s) => s.group === g).map((s) => ({ key: s.key, label: s.label })),
    }))
    .filter((g) => g.options.length > 0);
}

/** Link into the Explorer with filters preset. */
export function explorerLink(stat: string, season?: number, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams({ stat, ...(season ? { season: String(season) } : {}), ...extra });
  return `/explorer?${q.toString()}`;
}

const HOME_STAT_KEY = "nfl.homeLeaderStat";

/** The stat the home leaders panel last showed, if the browser lets us remember it. */
export function rememberedStat(): string | null {
  try {
    return window.localStorage.getItem(HOME_STAT_KEY);
  } catch {
    return null;
  }
}

export function rememberStat(key: string): void {
  try {
    window.localStorage.setItem(HOME_STAT_KEY, key);
  } catch {
    // Private browsing or storage turned off: the choice just won't stick.
  }
}
