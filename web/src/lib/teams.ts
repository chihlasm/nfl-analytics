/**
 * The 32 teams, keyed by the abbreviation nflverse uses.
 *
 *   primary / secondary  the official colours
 *   bright               a glow-safe version of the primary for accents and text on
 *                        near-black (dark primaries like navy can't glow on black)
 *
 * See lib/palette.ts for how a screen turns these into its theme.
 */
export interface Team {
  name: string;
  short: string;
  primary: string;
  secondary: string;
  bright: string;
}

export const TEAMS: Record<string, Team> = {
  ARI: { name: "Arizona Cardinals", short: "Cardinals", primary: "#97233F", secondary: "#FFB612", bright: "#FF3D6E" },
  ATL: { name: "Atlanta Falcons", short: "Falcons", primary: "#A71930", secondary: "#C9CED2", bright: "#FF3350" },
  BAL: { name: "Baltimore Ravens", short: "Ravens", primary: "#241773", secondary: "#9E7C0C", bright: "#8B6DFF" },
  BUF: { name: "Buffalo Bills", short: "Bills", primary: "#00338D", secondary: "#C60C30", bright: "#3D7BFF" },
  CAR: { name: "Carolina Panthers", short: "Panthers", primary: "#0085CA", secondary: "#BFC0BF", bright: "#2FB6FF" },
  CHI: { name: "Chicago Bears", short: "Bears", primary: "#0B162A", secondary: "#C83803", bright: "#FF6A2B" },
  CIN: { name: "Cincinnati Bengals", short: "Bengals", primary: "#FB4F14", secondary: "#E5E7EB", bright: "#FF6A2E" },
  CLE: { name: "Cleveland Browns", short: "Browns", primary: "#311D00", secondary: "#FF3C00", bright: "#FF5A1F" },
  DAL: { name: "Dallas Cowboys", short: "Cowboys", primary: "#003594", secondary: "#B0B7BC", bright: "#3F7DFF" },
  DEN: { name: "Denver Broncos", short: "Broncos", primary: "#FB4F14", secondary: "#2E5BA8", bright: "#FF6A2E" },
  DET: { name: "Detroit Lions", short: "Lions", primary: "#0076B6", secondary: "#C7CDD2", bright: "#2FA9FF" },
  GB: { name: "Green Bay Packers", short: "Packers", primary: "#203731", secondary: "#FFB612", bright: "#3DDC84" },
  HOU: { name: "Houston Texans", short: "Texans", primary: "#03202F", secondary: "#A71930", bright: "#FF3350" },
  IND: { name: "Indianapolis Colts", short: "Colts", primary: "#002C5F", secondary: "#A2AAAD", bright: "#3D86FF" },
  JAX: { name: "Jacksonville Jaguars", short: "Jaguars", primary: "#006778", secondary: "#D7A22A", bright: "#19C2D6" },
  KC: { name: "Kansas City Chiefs", short: "Chiefs", primary: "#E31837", secondary: "#FFB81C", bright: "#FF3B4E" },
  LA: { name: "Los Angeles Rams", short: "Rams", primary: "#003594", secondary: "#FFA300", bright: "#FFB020" },
  LAC: { name: "Los Angeles Chargers", short: "Chargers", primary: "#0080C6", secondary: "#FFC20E", bright: "#2FB0FF" },
  LV: { name: "Las Vegas Raiders", short: "Raiders", primary: "#000000", secondary: "#A5ACAF", bright: "#D1D5DB" },
  MIA: { name: "Miami Dolphins", short: "Dolphins", primary: "#008E97", secondary: "#FC4C02", bright: "#1AD4DE" },
  MIN: { name: "Minnesota Vikings", short: "Vikings", primary: "#4F2683", secondary: "#FFC62F", bright: "#A374FF" },
  NE: { name: "New England Patriots", short: "Patriots", primary: "#002244", secondary: "#C60C30", bright: "#FF3B55" },
  NO: { name: "New Orleans Saints", short: "Saints", primary: "#D3BC8D", secondary: "#E5E7EB", bright: "#E8D2A0" },
  NYG: { name: "New York Giants", short: "Giants", primary: "#0B2265", secondary: "#A71930", bright: "#4D7CFF" },
  NYJ: { name: "New York Jets", short: "Jets", primary: "#125740", secondary: "#FFFFFF", bright: "#2FD58A" },
  PHI: { name: "Philadelphia Eagles", short: "Eagles", primary: "#004C54", secondary: "#C4CCD0", bright: "#14D3C4" },
  PIT: { name: "Pittsburgh Steelers", short: "Steelers", primary: "#FFB612", secondary: "#F3F4F6", bright: "#FFC93C" },
  SEA: { name: "Seattle Seahawks", short: "Seahawks", primary: "#002244", secondary: "#69BE28", bright: "#7EE03B" },
  SF: { name: "San Francisco 49ers", short: "49ers", primary: "#AA0000", secondary: "#B3995D", bright: "#FF3030" },
  TB: { name: "Tampa Bay Buccaneers", short: "Buccaneers", primary: "#D50A0A", secondary: "#B1BABF", bright: "#FF2E2E" },
  TEN: { name: "Tennessee Titans", short: "Titans", primary: "#0C2340", secondary: "#4B92DB", bright: "#5AA9FF" },
  WAS: { name: "Washington Commanders", short: "Commanders", primary: "#5A1414", secondary: "#FFB612", bright: "#FFB612" },
};

export function team(abbr: string | null | undefined): Team | undefined {
  return abbr ? TEAMS[abbr] : undefined;
}
