/**
 * Viewer settings, remembered on this device (there are no accounts).
 *
 * homeLook: the colours of screens that belong to no team (Home, Players search,
 * Settings): "nfl" (league navy, red and white; the default), "ember", or a team
 * abbreviation such as "ATL" to wear a favourite team's colours.
 */
import { useSyncExternalStore } from "react";

import { TEAMS } from "./teams";

export type HomeLook = "nfl" | "ember" | keyof typeof TEAMS;

const KEY = "nfl.homeLook";
const listeners = new Set<() => void>();

function read(): HomeLook {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "nfl" || v === "ember" || (v && v in TEAMS)) return v as HomeLook;
  } catch {
    // storage blocked (private mode): fall through to the default
  }
  return "nfl";
}

let current: HomeLook = read();

export function setHomeLook(look: HomeLook) {
  current = look;
  try {
    localStorage.setItem(KEY, look);
  } catch {
    // not remembered on this device; still applies for this visit
  }
  listeners.forEach((fn) => fn());
}

export function useHomeLook(): HomeLook {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
    () => "nfl" as HomeLook,
  );
}
