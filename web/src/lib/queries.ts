/**
 * One hook per endpoint. The data changes once a day (news every 15 minutes), so
 * results stay fresh for a while and screens switch instantly from cache.
 */
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { api, type Explorer, type ExplorerOrder, type GameDetail, type ExplorerSort, type Injuries, type Meta, type PlayList, type PlaySort, type SeasonType, type StatCatalog, type TeamExplorer, type News, type PlayerProfile, type PlayerSummary, type Standings, type TeamProfile, type Week } from "./api";

const HOUR = 60 * 60 * 1000;

export function useMeta() {
  return useQuery({ queryKey: ["meta"], queryFn: () => api<Meta>("/api/meta"), staleTime: HOUR });
}

const LIVE_POLL = 30_000;
const GAME_DAY_POLL = 2 * 60_000;
const SCORES_STALE = 5 * 60_000;

/** True while any game is on, so the scoreboard keeps itself current. */
export function hasLiveGame(week: Week | undefined): boolean {
  return Boolean(week?.games.some((g) => g.live?.state === "in"));
}

/** A game today that isn't final yet (about to start, or nflverse is catching up). */
function gameDayPending(week: Week | undefined): boolean {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  return Boolean(week?.games.some((g) => !g.is_final && g.game_date === today));
}

/**
 * A week of games. While a game is on it refetches every 30 seconds (live scores
 * come from the API's scoreboard feed), every 2 minutes on a game day otherwise,
 * and only when the tab regains focus the rest of the time. Polling pauses while
 * the tab is hidden.
 */
export function useWeek(season: number | undefined, week: number | undefined) {
  return useQuery({
    queryKey: ["games", season, week],
    queryFn: () => api<Week>("/api/games", { season, week }),
    staleTime: (q) => (hasLiveGame(q.state.data) ? LIVE_POLL / 2 : SCORES_STALE),
    refetchInterval: (q) => (hasLiveGame(q.state.data) ? LIVE_POLL : gameDayPending(q.state.data) ? GAME_DAY_POLL : false),
    placeholderData: keepPreviousData,
  });
}

export function useInjuries(season?: number) {
  return useQuery({
    queryKey: ["injuries", season],
    queryFn: () => api<Injuries>("/api/injuries", { season }),
    staleTime: HOUR,
  });
}

export function useNews() {
  return useQuery({
    queryKey: ["news"],
    queryFn: () => api<News>("/api/news"),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });
}

export function usePlayerSearch(q: string) {
  const term = q.trim();
  return useQuery({
    queryKey: ["players", term],
    queryFn: () => api<PlayerSummary[]>("/api/players", { q: term, limit: 10 }),
    enabled: term.length >= 2,
    staleTime: HOUR,
    placeholderData: keepPreviousData,
  });
}

export function usePlayer(id: string | undefined, season: number | undefined) {
  return useQuery({
    queryKey: ["player", id, season],
    queryFn: () => api<PlayerProfile>(`/api/players/${encodeURIComponent(id ?? "")}`, { season }),
    enabled: Boolean(id),
    staleTime: HOUR,
    placeholderData: keepPreviousData,
  });
}

export function useStandings(season: number | undefined) {
  return useQuery({
    queryKey: ["standings", season],
    queryFn: () => api<Standings>("/api/teams", { season }),
    staleTime: HOUR,
    placeholderData: keepPreviousData,
  });
}

export function useTeam(abbr: string | undefined, season: number | undefined) {
  return useQuery({
    queryKey: ["team", abbr, season],
    queryFn: () => api<TeamProfile>(`/api/teams/${encodeURIComponent(abbr ?? "")}`, { season }),
    enabled: Boolean(abbr),
    staleTime: HOUR,
    placeholderData: keepPreviousData,
  });
}

/** The stat catalog only changes with a new release, so it is fetched once. */
export function useStatCatalog() {
  return useQuery({
    queryKey: ["stats"],
    queryFn: () => api<StatCatalog>("/api/stats"),
    staleTime: Infinity,
  });
}

/** A type alias (not an interface) so it passes straight through as query params. */
export type ExplorerFilters = {
  stat: string;
  min_plays?: number;
  season?: number;
  season_type?: SeasonType;
  position?: string;
  team?: string;
  min_games?: number;
  sort?: ExplorerSort;
  order?: ExplorerOrder;
};

/** The top few players on one stat (the home page's leaders panel). */
export function useTopPlayers(filters: ExplorerFilters, limit: number) {
  return useQuery({
    queryKey: ["explorer", filters, limit, 0],
    queryFn: () => api<Explorer>("/api/explorer", { ...filters, limit }),
    staleTime: HOUR,
    placeholderData: keepPreviousData,
  });
}

export const EXPLORER_PAGE = 50;

/** Every matching player, a page at a time ("Show more"). */
export function useExplorer(filters: ExplorerFilters) {
  return useInfiniteQuery({
    queryKey: ["explorer", filters, "pages"],
    queryFn: ({ pageParam }) => api<Explorer>("/api/explorer", { ...filters, limit: EXPLORER_PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => {
      const next = last.offset + last.rows.length;
      return next < last.total && last.rows.length > 0 ? next : undefined;
    },
    staleTime: HOUR,
    placeholderData: keepPreviousData,
  });
}

/** What the plays panel is showing (also its address-bar state). */
export type PlaysQuery = {
  /** A player's plays; leave out (and set subject "team" + team) for a team stat. */
  player?: string;
  subject?: "team";
  stat: string;
  season?: number;
  season_type?: SeasonType;
  week?: number;
  team?: string;
  sort?: PlaySort;
  counted_only?: string;
};

export const PLAYS_PAGE = 50;

export function usePlays(q: PlaysQuery | null) {
  return useInfiniteQuery({
    queryKey: ["plays", q],
    queryFn: ({ pageParam }) => {
      const { subject, ...params } = q as PlaysQuery;
      const path = subject === "team" ? "/api/team-plays" : "/api/plays";
      return api<PlayList>(path, { ...params, limit: PLAYS_PAGE, offset: pageParam });
    },
    initialPageParam: 0,
    getNextPageParam: (last) => {
      const next = last.offset + last.rows.length;
      return next < last.plays && last.rows.length > 0 ? next : undefined;
    },
    enabled: q !== null,
    staleTime: HOUR,
    placeholderData: keepPreviousData,
  });
}

export type TeamExplorerFilters = {
  stat: string;
  season?: number;
  season_type?: SeasonType;
  conference?: "AFC" | "NFC";
  order?: "best" | "worst";
};

/** All 32 teams ranked on one team stat. */
export function useTeamExplorer(filters: TeamExplorerFilters) {
  return useQuery({
    queryKey: ["explorer-teams", filters],
    queryFn: () => api<TeamExplorer>("/api/explorer/teams", filters),
    staleTime: HOUR,
    placeholderData: keepPreviousData,
  });
}

/** One game's page. Refreshes every 30 seconds while the game is on. */
export function useGame(gameId: string | undefined) {
  return useQuery({
    queryKey: ["game", gameId],
    queryFn: () => api<GameDetail>(`/api/games/${encodeURIComponent(gameId ?? "")}`),
    enabled: Boolean(gameId),
    staleTime: (q) => (q.state.data?.game.live?.state === "in" ? LIVE_POLL / 2 : SCORES_STALE),
    refetchInterval: (q) => (q.state.data?.game.live?.state === "in" ? LIVE_POLL : false),
  });
}
