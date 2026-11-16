/**
 * The 32 teams, keyed by the abbreviation nflverse uses. Colours are used ONLY to
 * identify a team (the two-tone mark beside its name), never for emphasis.
 */
export interface Team {
  name: string;
  short: string;
  primary: string;
  secondary: string;
}

export const TEAMS: Record<string, Team> = {
  ARI: { name: "Arizona Cardinals", short: "Cardinals", primary: "#97233F", secondary: "#FFB612" },
  ATL: { name: "Atlanta Falcons", short: "Falcons", primary: "#A71930", secondary: "#000000" },
  BAL: { name: "Baltimore Ravens", short: "Ravens", primary: "#241773", secondary: "#9E7C0C" },
  BUF: { name: "Buffalo Bills", short: "Bills", primary: "#00338D", secondary: "#C60C30" },
  CAR: { name: "Carolina Panthers", short: "Panthers", primary: "#0085CA", secondary: "#101820" },
  CHI: { name: "Chicago Bears", short: "Bears", primary: "#0B162A", secondary: "#C83803" },
  CIN: { name: "Cincinnati Bengals", short: "Bengals", primary: "#FB4F14", secondary: "#000000" },
  CLE: { name: "Cleveland Browns", short: "Browns", primary: "#311D00", secondary: "#FF3C00" },
  DAL: { name: "Dallas Cowboys", short: "Cowboys", primary: "#003594", secondary: "#869397" },
  DEN: { name: "Denver Broncos", short: "Broncos", primary: "#FB4F14", secondary: "#002244" },
  DET: { name: "Detroit Lions", short: "Lions", primary: "#0076B6", secondary: "#B0B7BC" },
  GB: { name: "Green Bay Packers", short: "Packers", primary: "#203731", secondary: "#FFB612" },
  HOU: { name: "Houston Texans", short: "Texans", primary: "#03202F", secondary: "#A71930" },
  IND: { name: "Indianapolis Colts", short: "Colts", primary: "#002C5F", secondary: "#A2AAAD" },
  JAX: { name: "Jacksonville Jaguars", short: "Jaguars", primary: "#006778", secondary: "#D7A22A" },
  KC: { name: "Kansas City Chiefs", short: "Chiefs", primary: "#E31837", secondary: "#FFB81C" },
  LA: { name: "Los Angeles Rams", short: "Rams", primary: "#003594", secondary: "#FFA300" },
  LAC: { name: "Los Angeles Chargers", short: "Chargers", primary: "#0080C6", secondary: "#FFC20E" },
  LV: { name: "Las Vegas Raiders", short: "Raiders", primary: "#000000", secondary: "#A5ACAF" },
  MIA: { name: "Miami Dolphins", short: "Dolphins", primary: "#008E97", secondary: "#FC4C02" },
  MIN: { name: "Minnesota Vikings", short: "Vikings", primary: "#4F2683", secondary: "#FFC62F" },
  NE: { name: "New England Patriots", short: "Patriots", primary: "#002244", secondary: "#C60C30" },
  NO: { name: "New Orleans Saints", short: "Saints", primary: "#D3BC8D", secondary: "#101820" },
  NYG: { name: "New York Giants", short: "Giants", primary: "#0B2265", secondary: "#A71930" },
  NYJ: { name: "New York Jets", short: "Jets", primary: "#125740", secondary: "#FFFFFF" },
  PHI: { name: "Philadelphia Eagles", short: "Eagles", primary: "#004C54", secondary: "#A5ACAF" },
  PIT: { name: "Pittsburgh Steelers", short: "Steelers", primary: "#FFB612", secondary: "#101820" },
  SEA: { name: "Seattle Seahawks", short: "Seahawks", primary: "#002244", secondary: "#69BE28" },
  SF: { name: "San Francisco 49ers", short: "49ers", primary: "#AA0000", secondary: "#B3995D" },
  TB: { name: "Tampa Bay Buccaneers", short: "Buccaneers", primary: "#D50A0A", secondary: "#34302B" },
  TEN: { name: "Tennessee Titans", short: "Titans", primary: "#0C2340", secondary: "#4B92DB" },
  WAS: { name: "Washington Commanders", short: "Commanders", primary: "#5A1414", secondary: "#FFB612" },
};

export function team(abbr: string | null | undefined): Team | undefined {
  return abbr ? TEAMS[abbr] : undefined;
}
