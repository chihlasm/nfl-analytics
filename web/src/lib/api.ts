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

/** A game in progress (or just finished) from the live scoreboard. */
export interface LiveStatus {
  state: "pre" | "in" | "post";
  /** "7:34 - 2nd", "Halftime", "Final/OT" */
  detail: string;
  period: number | null;
  clock: string | null;
  away_score: number | null;
  home_score: number | null;
  /** Team with the ball. */
  possession: string | null;
  /** "3rd & 7 at SF 34" */
  down_distance: string | null;
  red_zone: boolean;
  last_play: string | null;
  is_overtime: boolean;
  updated_at: string;
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
  /** Set while the live scoreboard has the game on (or nflverse hasn't posted the final). */
  live: LiveStatus | null;
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
  unit: StatUnit;
  has_plays: boolean;
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

export type StatGroup = "passing" | "rushing" | "receiving" | "defense" | "advanced" | "offense";
export type StatUnit = "count" | "rate" | "epa" | "yards" | "points";

export interface StatInfo {
  key: string;
  label: string;
  short: string;
  group: StatGroup;
  decimals: number;
  /** stat = box score; metric = an advanced stat (sql/metrics.sql); team = a team stat. */
  kind: "stat" | "metric" | "team";
  /** rate values are 0-1 and shown as a percentage. */
  unit: StatUnit;
  description: string | null;
  first_season: number | null;
  /** Whether "per game" means anything for it (not for rates). */
  per_game: boolean;
  /** Data credit to show wherever it appears (FTN charting). */
  credit: string | null;
  /** Sets which end of a ranking is "best". */
  higher_is_better: boolean;
  /** Whether tapping it can list plays (points come from scores, so no). */
  has_plays: boolean;
}

export interface StatCatalog {
  stats: StatInfo[];
  position_groups: string[];
  team_stats: StatInfo[];
}

export type SeasonType = "REG" | "POST" | "ALL";
export type ExplorerSort = "total" | "per_game";
export type ExplorerOrder = "desc" | "asc";

export interface ExplorerRow {
  rank: number;
  player_id: string;
  name: string;
  position: string | null;
  position_group: string | null;
  /** With a team filter, that team; otherwise the player's latest team. */
  team: string | null;
  games: number;
  value: number;
  per_game: number;
  /** Plays behind a rate or average. */
  attempts: number | null;
}

export interface Explorer {
  season: number;
  seasons: number[];
  season_type: SeasonType;
  stat: StatInfo;
  sort: ExplorerSort;
  order: ExplorerOrder;
  position_group: string | null;
  team: string | null;
  min_games: number;
  through_week: number | null;
  total: number;
  offset: number;
  rows: ExplorerRow[];
  /** Qualifier for rates and averages. */
  min_plays: number;
  /** Why there are no rows (charting starts later), if that's the reason. */
  note: string | null;
}

export interface PlayerRef {
  player_id: string;
  name: string;
  position: string | null;
  team: string | null;
}

export type PlayTag = "TD" | "INT" | "Sack" | "Fumble" | "Penalty";

export interface PlayRow {
  game_id: string;
  play_id: number;
  season_type: string;
  week: number;
  /** The offense on the play. */
  team: string | null;
  /** The other team, from the player's side. */
  opponent: string | null;
  is_home: boolean | null;
  qtr: number | null;
  clock: string | null;
  down: number | null;
  distance: number | null;
  field: string | null;
  description: string | null;
  value: number | null;
  epa: number | null;
  air_yards: number | null;
  yards: number | null;
  /** For rates: whether this play is one of the counted ones (a miss). */
  counted: boolean;
  tags: PlayTag[];
}

export interface PlayWeek {
  season_type: string;
  week: number;
  plays: number;
  value: number | null;
}

export type PlaySort = "time" | "value";

export interface PlayList {
  stat: StatInfo;
  /** Null for a team stat. */
  player: PlayerRef | null;
  /** The team, for a team stat. */
  subject_team: string | null;
  season: number;
  season_type: SeasonType;
  week: number | null;
  team: string | null;
  sort: PlaySort;
  counted_only: boolean;
  value: number | null;
  /** nflverse's box-score total for the same scope (box-score stats only). */
  official: number | null;
  plays: number;
  counted: number;
  weeks: PlayWeek[];
  offset: number;
  rows: PlayRow[];
}

export interface TeamExplorerRow {
  rank: number;
  team: string;
  name: string;
  conference: string | null;
  division: string | null;
  games: number;
  value: number;
  /** Plays behind it (null for points, which come from scores). */
  plays: number | null;
}

export interface TeamExplorer {
  season: number;
  seasons: number[];
  season_type: SeasonType;
  stat: StatInfo;
  order: "best" | "worst";
  conference: "AFC" | "NFC" | null;
  through_week: number | null;
  league_avg: number | null;
  rows: TeamExplorerRow[];
}

export interface GameInfo {
  stadium: string | null;
  roof: string | null;
  surface: string | null;
  temp_f: number | null;
  wind_mph: number | null;
  home_coach: string | null;
  away_coach: string | null;
  referee: string | null;
  home_moneyline: number | null;
  away_moneyline: number | null;
  is_division_game: boolean;
}

export interface QuarterScore {
  label: string;
  away: number;
  home: number;
}

/** One row of a team comparison: the same stat for both teams. */
export interface GameStat {
  key: string;
  label: string;
  group: "box" | "advanced";
  away: number | null;
  home: number | null;
  /** Split figures like "5/12" or "31:04". */
  away_text: string | null;
  home_text: string | null;
  unit: StatUnit;
  decimals: number;
  /** Null when neither side is better (plays run, say). */
  higher_is_better: boolean | null;
  edge: "away" | "home" | null;
  /** A team stat from the catalog, so it opens its plays. */
  has_plays: boolean;
}

export interface WinPoint {
  /** Seconds since kickoff; overtime continues past 3600. */
  t: number;
  home_wp: number;
}

export interface GamePlay {
  play_id: number;
  qtr: number | null;
  clock: string | null;
  team: string | null;
  description: string | null;
  /** How much the play moved the home team's win probability. */
  home_wp_change: number | null;
  away_score: number | null;
  home_score: number | null;
  kind: "TD" | "FG" | "Safety" | "Turnover" | null;
}

export interface PlayerLine {
  player_id: string;
  name: string;
  position: string | null;
  stats: Record<string, number>;
}

export interface PlayerGroup {
  key: string;
  label: string;
  columns: StatInfo[];
  away: PlayerLine[];
  home: PlayerLine[];
}

export interface GameRecap {
  quarters: QuarterScore[];
  team_stats: GameStat[];
  win_probability: WinPoint[];
  key_plays: GamePlay[];
  scoring_plays: GamePlay[];
  players: PlayerGroup[];
}

/** One team's stat against the other's, with league ranks (1 = best). */
export interface MatchupRow {
  label: string;
  away_key: string;
  home_key: string;
  away_value: number | null;
  away_rank: number | null;
  home_value: number | null;
  home_rank: number | null;
  unit: StatUnit;
  decimals: number;
  teams: number;
  edge: "away" | "home" | null;
}

export interface Meeting {
  game_id: string;
  season: number;
  week: number;
  game_type: string;
  game_date: string | null;
  home: string;
  away_score: number | null;
  home_score: number | null;
  winner: string | null;
}

export interface GamePreview {
  stats_season: number;
  stats_note: string | null;
  away_record: TeamRecord | null;
  home_record: TeamRecord | null;
  away_form: GameResult[];
  home_form: GameResult[];
  away_offense: MatchupRow[];
  home_offense: MatchupRow[];
  side_by_side: MatchupRow[];
  meetings: Meeting[];
  away_leaders: LeaderBoard[];
  home_leaders: LeaderBoard[];
  injury_week: number | null;
  away_injuries: InjuryRow[];
  home_injuries: InjuryRow[];
}

export interface GameDetail {
  game: Game;
  info: GameInfo;
  /** recap once the play-by-play is in; preview before that (or while nflverse catches up). */
  mode: "recap" | "preview";
  recap: GameRecap | null;
  preview: GamePreview | null;
}
