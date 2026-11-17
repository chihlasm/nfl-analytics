/**
 * Opening the plays panel. Its state lives in the address bar (play_* params) so
 * it survives a refresh, can be shared, and the back button closes it.
 */
import { useCallback } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

import type { PlaySort, SeasonType } from "./api";
import type { PlaysQuery } from "./queries";

const KEYS = {
  player: "play_player",
  stat: "play_stat",
  season: "play_season",
  season_type: "play_type",
  week: "play_week",
  team: "play_team",
  sort: "play_sort",
  counted_only: "play_counted",
} as const;

export interface PlaysTarget {
  player: string;
  stat: string;
  season?: number;
  season_type?: SeasonType;
  week?: number;
  team?: string;
}

/** Read the panel's state from the address bar; null when it is closed. */
export function readPlays(params: URLSearchParams): PlaysQuery | null {
  const player = params.get(KEYS.player);
  const stat = params.get(KEYS.stat);
  if (!player || !stat) return null;
  const num = (k: string) => {
    const v = Number(params.get(k));
    return Number.isInteger(v) && v > 0 ? v : undefined;
  };
  const type = params.get(KEYS.season_type);
  const sort = params.get(KEYS.sort);
  return {
    player,
    stat,
    season: num(KEYS.season),
    season_type: type === "POST" || type === "ALL" ? type : undefined,
    week: num(KEYS.week),
    team: params.get(KEYS.team) || undefined,
    sort: sort === "value" ? (sort as PlaySort) : undefined,
    counted_only: params.get(KEYS.counted_only) === "1" ? "true" : undefined,
  };
}

function write(params: URLSearchParams, q: Partial<PlaysQuery>) {
  for (const [field, key] of Object.entries(KEYS)) {
    const v = q[field as keyof PlaysQuery];
    if (v === undefined || v === "" || v === null) params.delete(key);
    else params.set(key, field === "counted_only" ? "1" : String(v));
  }
}

/** open(target) shows the plays behind a number; it adds a history entry. */
export function useOpenPlays() {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(
    (t: PlaysTarget) => {
      const params = new URLSearchParams(location.search);
      write(params, { ...t, season_type: t.season_type === "REG" ? undefined : t.season_type });
      navigate({ pathname: location.pathname, search: params.toString() }, { state: { playsOpened: true } });
    },
    [navigate, location.pathname, location.search],
  );
}

/** Change the open panel's view (week, sort, counted) without adding history. */
export function useUpdatePlays() {
  const [, setParams] = useSearchParams();
  return useCallback(
    (change: Partial<PlaysQuery>) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const current = readPlays(prev);
          if (current) write(next, { ...current, ...change });
          return next;
        },
        { replace: true, preventScrollReset: true },
      ),
    [setParams],
  );
}

/** Close: step back if we opened it (so Forward reopens it), else just clear it. */
export function useClosePlays() {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(() => {
    if ((location.state as { playsOpened?: boolean } | null)?.playsOpened) {
      navigate(-1);
      return;
    }
    const params = new URLSearchParams(location.search);
    write(params, { player: undefined, stat: undefined, season: undefined, season_type: undefined, week: undefined, team: undefined, sort: undefined, counted_only: undefined });
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true, preventScrollReset: true });
  }, [navigate, location]);
}
