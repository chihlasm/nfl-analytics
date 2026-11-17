/**
 * Thin, typed wrapper around the read-only NFL Analytics API (same origin, /api).
 * The types mirror src/nfl_analytics/api/models.py; keep the two in step.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function messageFrom(body: unknown, status: number): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
  }
  if (status === 503) return "The database is still being built. Try again in a few minutes.";
  if (status >= 500) return "The server had a problem. Try again in a moment.";
  return "Something went wrong. Try again.";
}

export async function api<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" } });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, messageFrom(body, response.status));
  return body as T;
}

export interface Meta {
  built_at: string;
  latest_season: number | null;
  latest_week: number | null;
  current_season: number;
  current_week: number | null;
}

export interface TeamScore {
  team: string;
  score: number | null;
  qb_name: string | null;
}

export interface Game {
  game_id: string;
  season: number;
  week: number;
  game_type: string;
  game_date: string | null;
  kickoff_time_et: string | null;
  home: TeamScore;
  away: TeamScore;
  is_final: boolean;
  is_overtime: boolean;
  spread_line: number | null;
  total_line: number | null;
  stadium: string | null;
  roof: string | null;
}

export interface Week {
  season: number;
  week: number;
  weeks: number[];
  games: Game[];
}

export interface LeaderRow {
  player_id: string;
  name: string;
  position: string | null;
  team: string | null;
  value: number;
  games: number;
}

export interface LeaderBoard {
  key: string;
  label: string;
  decimals: number;
  rows: LeaderRow[];
}

export interface Leaders {
  season: number;
  through_week: number | null;
  boards: LeaderBoard[];
}

export type InjuryStatus = "Out" | "Doubtful" | "Questionable";

export interface InjuryRow {
  player_id: string | null;
  player_name: string;
  team: string;
  position: string | null;
  status: InjuryStatus;
  injury: string | null;
  practice_status: string | null;
}

export interface Injuries {
  season: number;
  week: number | null;
  counts: Record<InjuryStatus, number>;
  rows: InjuryRow[];
}

export interface PlayerSummary {
  player_id: string;
  display_name: string;
  position: string | null;
  position_group: string | null;
  team: string | null;
  last_season: number | null;
}

export interface StatColumn {
  key: string;
  label: string;
  short: string;
  group: string;
  decimals: number;
}

export interface WeekLine {
  season_type: string;
  week: number;
  team: string | null;
  opponent: string | null;
  snap_pct: number | null;
  injury_status: string | null;
  stats: Record<string, number | null>;
}

export interface SeasonLine {
  season: number;
  team: string | null;
  games: number;
  stats: Record<string, number | null>;
}

export interface MetricValue {
  name: string;
  label: string;
  description: string;
  unit: "count" | "rate" | "epa";
  value: number | null;
  numerator: number;
  denominator: number | null;
}

export type Depth = "behind_los" | "short" | "intermediate" | "deep";
export type Direction = "left" | "middle" | "right";

export interface ThrowCell {
  depth: Exclude<Depth, "behind_los">;
  direction: Direction;
  attempts: number;
  completion_rate: number | null;
  epa_per_attempt: number | null;
}

export interface DepthLine {
  depth: Depth;
  attempts: number;
  completions: number;
  /** Charted uncatchable incompletions; null before FTN charting (2022). */
  misses: number | null;
}

export interface PlayerProfile {
  player: PlayerSummary;
  college: string | null;
  height_in: number | null;
  weight_lb: number | null;
  years_of_experience: number | null;
  draft: string | null;
  season: number | null;
  seasons: number[];
  columns: StatColumn[];
  totals: Record<string, number | null>;
  weeks: WeekLine[];
  career: SeasonLine[];
  metrics: MetricValue[];
  throw_map: ThrowCell[];
  depth: DepthLine[];
}

export interface NewsItem {
  title: string;
  url: string;
  source: string;
  published_at: string | null;
}

export interface News {
  items: NewsItem[];
  fetched_at: string | null;
  sources_ok: string[];
  sources_failed: string[];
}

export interface TeamInfo {
  team: string;
  name: string;
  nickname: string | null;
  conference: string | null;
  division: string | null;
}

export interface TeamRecord {
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
  home: string;
  away: string;
  division: string;
  streak: string | null;
}

export interface StandingRow {
  info: TeamInfo;
  record: TeamRecord;
}

export interface Standings {
  season: number;
  seasons: number[];
  divisions_apply: boolean;
  teams: StandingRow[];
}

export type GameResult = "W" | "L" | "T";

export interface TeamGame {
  game_id: string;
  week: number;
  game_type: string;
  game_date: string | null;
  kickoff_time_et: string | null;
  opponent: string;
  is_home: boolean;
  points_for: number | null;
  points_against: number | null;
  result: GameResult | null;
  is_overtime: boolean;
  is_division_game: boolean;
  /** Spread from this team's side: negative means favoured. */
  team_line: number | null;
  total_line: number | null;
  qb_name: string | null;
  opponent_qb_name: string | null;
}

export interface TeamRank {
  key: string;
  label: string;
  side: "offense" | "defense";
  value: number | null;
  rank: number | null;
  teams: number;
  league_avg: number | null;
  decimals: number;
  unit: "" | "%" | "yds" | "pts";
}

export interface TeamProfile {
  info: TeamInfo;
  season: number;
  seasons: number[];
  record: TeamRecord;
  division_rank: number | null;
  division: StandingRow[];
  games: TeamGame[];
  ranks: TeamRank[];
  leaders: LeaderBoard[];
  injury_week: number | null;
  injuries: InjuryRow[];
}
