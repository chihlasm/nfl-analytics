/**
 * Vault (dark, the default) or Hearth (light), the same two themes as WePlan.
 * There are no accounts here, so the choice is remembered on this device only.
 */
import { useSyncExternalStore } from "react";

export type Theme = "dark" | "light";

const KEY = "nfl.theme";
const CHROME: Record<Theme, string> = { dark: "#0A0E13", light: "#F4EFE9" };
const listeners = new Set<() => void>();

function stored(): Theme {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark"; // storage blocked
  }
}

let current: Theme = stored();

function apply(theme: Theme) {
  current = theme;
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", CHROME[theme]));
  listeners.forEach((fn) => fn());
}

/** Call once before the first render, so the right theme paints immediately. */
export function initTheme() {
  apply(current);
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // not remembered on this device; still applies for this visit
  }
  apply(theme);
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
}
