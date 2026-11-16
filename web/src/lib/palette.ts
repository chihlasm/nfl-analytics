import { useEffect, type CSSProperties } from "react";

import { team } from "./teams";

/** The league accent, for screens that belong to no team (Home, search). */
export const LEAGUE = { primary: "#FF4D1A", bright: "#FF4D1A", secondary: "#FFFFFF" };

/** "#a71930" -> "rgba(167,25,48,0.5)". */
export function alpha(hex: string, a: number): string {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Mix a colour toward black: amount 0 = unchanged, 1 = black. */
function darken(hex: string, amount: number): string {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  const f = (c: number) => Math.round(c * (1 - amount)).toString(16).padStart(2, "0");
  return `#${f((n >> 16) & 255)}${f((n >> 8) & 255)}${f(n & 255)}`;
}

/**
 * The CSS variables that theme a screen (see the notes at the top of styles.css).
 * Pass a team abbreviation, or nothing for the league accent.
 */
export function themeVars(abbr?: string | null): CSSProperties {
  const t = team(abbr) ?? LEAGUE;
  return {
    "--tp": t.primary,
    "--tb": t.bright,
    "--ts": t.secondary,
    "--td": darken(t.primary, 0.82),
  } as CSSProperties;
}

/**
 * Theme the whole app (shell, page background, controls, browser chrome) in a
 * team's colours while this screen is shown. Pass null for the league accent.
 */
export function useScreenTeam(abbr: string | null | undefined) {
  useEffect(() => {
    const root = document.documentElement;
    const vars = themeVars(abbr) as Record<string, string>;
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", vars["--td"] ?? "#050505");
  }, [abbr]);
}

/** The two-tone team disc used beside every team name. */
export function teamDisc(abbr: string | null | undefined, size = 12): CSSProperties {
  const t = team(abbr);
  const p = t?.primary ?? "#374151";
  const s = t?.secondary ?? "#6b7280";
  return {
    width: size,
    height: size,
    flex: "none",
    borderRadius: 999,
    background: `linear-gradient(135deg, ${p} 0 55%, ${s} 55%)`,
    boxShadow: `0 0 0 1.5px rgba(255,255,255,0.3), 0 0 ${Math.round(size * 1.1)}px ${t ? alpha(t.bright, 0.8) : "transparent"}`,
  };
}
