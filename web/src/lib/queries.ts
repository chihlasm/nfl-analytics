/**
 * One hook per endpoint. The data changes once a day (news every 15 minutes), so
 * results stay fresh for a while and screens switch instantly from cache.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api, type Injuries, type Leaders, type Meta, type News, type PlayerProfile, type PlayerSummary, type Standings, type TeamProfile, type Week } from "./api";

const HOUR = 60 * 60 * 1000;

export function useMeta() {
  return useQuery({ queryKey: ["meta"], queryFn: () => api<Meta>("/api/meta"), staleTime: HOUR });
}

export function useWeek(season: number | undefined, week: number | undefined) {
  return useQuery({
    queryKey: ["games", season, week],
    queryFn: () => api<Week>("/api/games", { season, week }),
    staleTime: HOUR,
    placeholderData: keepPreviousData,
  });
}

export function useLeaders(season?: number) {
  return useQuery({
    queryKey: ["leaders", season],
    queryFn: () => api<Leaders>("/api/leaders", { season, limit: 5 }),
    staleTime: HOUR,
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
