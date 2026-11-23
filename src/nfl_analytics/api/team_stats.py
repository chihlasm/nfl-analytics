"""Team stats: one definition per stat, used everywhere it appears.

Each stat says which plays count (a filter on the `plays` view, from the
offense's or the defense's side), what each play adds, and how plays combine
into the figure: an average per play, a rate, a per-game figure or a total.
The league ranking, the team page and the plays panel all use the same
definition, so they can't disagree. Points come from final scores
(`team_games`), not plays, so they rank but have no plays list.

SQL fragments here are trusted constants. The team, season and week are
always bound parameters.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import duckdb

from nfl_analytics.api import models as m

Side = Literal["offense", "defense"]
Combine = Literal["mean", "per_game", "sum"]
SeasonType = Literal["REG", "POST", "ALL"]

# Scrimmage plays only: passes (sacks count as passes, as in nflverse) and runs.
# Kneels, spikes, two-point tries and plays wiped out by penalties are left out.
SCRIMMAGE = "play_type IN ('pass', 'run') AND coalesce(two_point_attempt, 0) = 0"
# A big play: a run of 10+ yards or a pass of 20+ (the common definition).
EXPLOSIVE = (
    "CASE WHEN (play_type = 'run' AND yards_gained >= 10)"
    " OR (play_type = 'pass' AND yards_gained >= 20) THEN 1 ELSE 0 END"
)


@dataclass(frozen=True, slots=True)
class TeamStat:
    key: str
    label: str
    short: str
    side: Side
    higher_is_better: bool
    decimals: int
    unit: str  # count | rate (0-1) | epa | yards | points
    combine: Combine
    value: str = "1"
    """What one play adds."""
    where: str = "TRUE"
    """Which scrimmage plays count (beyond SCRIMMAGE)."""
    description: str | None = None
    from_scores: bool = False
    """Points: computed from final scores, so there is no plays list."""


def _pair(
    key: str,
    label: str,
    allowed_label: str,
    short: str,
    *,
    higher_is_better: bool,
    decimals: int,
    unit: str,
    combine: Combine,
    value: str = "1",
    where: str = "TRUE",
    description: str | None = None,
) -> tuple[TeamStat, TeamStat]:
    """The same stat from both sides: what an offense does, what a defense allows."""
    return (
        TeamStat(key, label, short, "offense", higher_is_better, decimals, unit, combine,
                 value, where, description),
        TeamStat(f"{key}_allowed", allowed_label, short, "defense", not higher_is_better,
                 decimals, unit, combine, value, where, description),
    )  # fmt: skip


TEAM_STATS: tuple[TeamStat, ...] = (
    TeamStat(
        "points_per_game", "Points per game", "PTS", "offense", True, 1, "points", "per_game",
        from_scores=True,
    ),
    TeamStat(
        "points_allowed_per_game", "Points allowed per game", "PTS", "defense", False, 1,
        "points", "per_game", from_scores=True,
    ),
    *_pair(
        "yards_per_play", "Yards per play", "Yards per play allowed", "Y/P",
        higher_is_better=True, decimals=2, unit="yards", combine="mean", value="yards_gained",
    ),
    *_pair(
        "epa_per_play", "EPA per play", "EPA per play allowed", "EPA",
        higher_is_better=True, decimals=3, unit="epa", combine="mean", value="epa",
        description="Expected points added: how much each play changed the scoring outlook.",
    ),
    *_pair(
        "success_rate", "Success rate", "Success rate allowed", "SR",
        higher_is_better=True, decimals=1, unit="rate", combine="mean", value="success",
        description=(
            "Plays that kept the drive on schedule: 40% of the yards needed on 1st down,"
            " 60% on 2nd, all of them on 3rd and 4th."
        ),
    ),
    *_pair(
        "explosive_rate", "Explosive play rate", "Explosive plays allowed", "XPL",
        higher_is_better=True, decimals=1, unit="rate", combine="mean", value=EXPLOSIVE,
        description="Runs of 10+ yards and passes of 20+ yards, as a share of all plays.",
    ),
    *_pair(
        "third_down_rate", "Third-down conversion rate", "Third-down rate allowed", "3RD",
        higher_is_better=True, decimals=1, unit="rate", combine="mean",
        value="coalesce(third_down_converted, 0)", where="down = 3",
        description="Third-down plays that earned a first down or a touchdown.",
    ),
    *_pair(
        "dropback_epa", "EPA per dropback", "EPA per dropback allowed", "PASS EPA",
        higher_is_better=True, decimals=3, unit="epa", combine="mean", value="epa",
        where="qb_dropback = 1",
        description="Expected points added on dropbacks: passes, sacks and scrambles.",
    ),
    *_pair(
        "rush_epa", "EPA per rush", "EPA per rush allowed", "RUSH EPA",
        higher_is_better=True, decimals=3, unit="epa", combine="mean", value="epa",
        where="play_type = 'run' AND coalesce(qb_scramble, 0) = 0",
        description="Expected points added on designed runs (scrambles count as dropbacks).",
    ),
    *_pair(
        "early_down_success", "Early-down success rate", "Early-down success allowed", "1-2 SR",
        higher_is_better=True, decimals=1, unit="rate", combine="mean", value="success",
        where="down IN (1, 2)",
        description="Success rate on first and second down, where offenses set up the drive.",
    ),
    *_pair(
        "pass_yards_per_game", "Passing yards per game", "Passing yards allowed per game", "PASS",
        higher_is_better=True, decimals=1, unit="yards", combine="per_game",
        value="yards_gained", where="play_type = 'pass'",
    ),
    *_pair(
        "rush_yards_per_game", "Rushing yards per game", "Rushing yards allowed per game", "RUSH",
        higher_is_better=True, decimals=1, unit="yards", combine="per_game",
        value="yards_gained", where="play_type = 'run'",
    ),
    TeamStat(
        "sacks_taken", "Sacks taken", "SK", "offense", False, 0, "count", "sum",
        where="sack = 1",
    ),
    TeamStat(
        "sacks", "Sacks", "SK", "defense", True, 0, "count", "sum", where="sack = 1",
    ),
    TeamStat(
        "giveaways", "Giveaways", "GIVE", "offense", False, 0, "count", "sum",
        value="coalesce(interception, 0) + coalesce(fumble_lost, 0)",
        where="(interception = 1 OR fumble_lost = 1)",
        description="Interceptions thrown and fumbles lost.",
    ),
    TeamStat(
        "takeaways", "Takeaways", "TAKE", "defense", True, 0, "count", "sum",
        value="coalesce(interception, 0) + coalesce(fumble_lost, 0)",
        where="(interception = 1 OR fumble_lost = 1)",
        description="Interceptions and fumble recoveries.",
    ),
)  # fmt: skip
TEAM_STATS_BY_KEY = {s.key: s for s in TEAM_STATS}


def team_column(stat: TeamStat) -> str:
    return "defteam" if stat.side == "defense" else "posteam"


def info(stat: TeamStat) -> m.StatInfo:
    return m.StatInfo(
        key=stat.key,
        label=stat.label,
        short=stat.short,
        group=stat.side,
        decimals=stat.decimals,
        kind="team",
        unit=stat.unit,
        description=stat.description,
        per_game=False,
        higher_is_better=stat.higher_is_better,
        has_plays=not stat.from_scores,
    )


def _scope(
    season: int, season_type: SeasonType, week: int | None = None
) -> tuple[str, dict[str, object]]:
    where = ["season = $s"]
    params: dict[str, object] = {"s": season}
    if season_type != "ALL":
        where.append("season_type = $st")
        params["st"] = season_type
    if week is not None:
        where.append("week = $w")
        params["w"] = week
    return " AND ".join(where), params


def _combine(stat: TeamStat, total: str, plays: str, games: str) -> str:
    if stat.combine == "mean":
        return f"({total})::DOUBLE / nullif({plays}, 0)"
    if stat.combine == "per_game":
        return f"({total})::DOUBLE / nullif({games}, 0)"
    return f"({total})::DOUBLE"


@dataclass(frozen=True, slots=True)
class TeamValue:
    team: str
    value: float
    games: int
    plays: int | None


def league_values(
    cur: duckdb.DuckDBPyConnection,
    stat: TeamStat,
    season: int,
    *,
    season_type: SeasonType = "REG",
    week: int | None = None,
    team: str | None = None,
    game_id: str | None = None,
) -> list[TeamValue]:
    """Every team's figure (or one team's, with `team`; one game's, with `game_id`)."""
    scope, params = _scope(season, season_type, week)
    if game_id is not None:
        scope += " AND game_id = $g"
        params["g"] = game_id
    if stat.from_scores:
        game_type = {"REG": "game_type = 'REG'", "POST": "game_type <> 'REG'", "ALL": "TRUE"}
        where = scope.replace("season_type = $st", game_type[season_type])
        params.pop("st", None)
        side = "points_for" if stat.side == "offense" else "points_against"
        if team is not None:
            where += " AND team = $t"
            params["t"] = team
        rows = cur.execute(
            f"SELECT team, avg({side})::DOUBLE, count(*) FROM team_games "
            f"WHERE {where} AND is_final GROUP BY team",
            params,
        ).fetchall()
        return [TeamValue(r[0], float(r[1]), int(r[2]), None) for r in rows if r[1] is not None]

    col = team_column(stat)
    if team is not None:
        scope += f" AND {col} = $t"
        params["t"] = team
    rows = cur.execute(
        f"""
        WITH games AS (
            -- Games come from all scrimmage plays, so per-game stats divide by games played
            -- even when the stat's own plays skip a game (no sacks that week, say).
            SELECT {col} AS team, count(DISTINCT game_id) AS games
            FROM plays WHERE {scope} AND {SCRIMMAGE} AND {col} IS NOT NULL GROUP BY 1
        ),
        counted AS (
            SELECT {col} AS team, sum({stat.value}) AS total, count(*) AS plays
            FROM plays WHERE {scope} AND {SCRIMMAGE} AND ({stat.where}) AND {col} IS NOT NULL
            GROUP BY 1
        )
        SELECT g.team, {_combine(stat, "coalesce(c.total, 0)", "c.plays", "g.games")} AS value,
               g.games, coalesce(c.plays, 0) AS plays
        FROM games AS g LEFT JOIN counted AS c USING (team)
        """,
        params,
    ).fetchall()
    return [TeamValue(r[0], float(r[1]), int(r[2]), int(r[3])) for r in rows if r[1] is not None]


def ranked(
    values: list[TeamValue], stat: TeamStat, *, best_first: bool = True
) -> list[tuple[int, TeamValue]]:
    """Standard competition ranking (ties share the better rank), best first by default."""
    better_high = stat.higher_is_better == best_first
    ordered = sorted(values, key=lambda v: (-v.value if better_high else v.value, v.team))
    out: list[tuple[int, TeamValue]] = []
    for i, v in enumerate(ordered):
        rank = out[-1][0] if out and out[-1][1].value == v.value else i + 1
        out.append((rank, v))
    return out


def play_rule(stat: TeamStat) -> str:
    """Which plays count for team `$t` (only for stats that have plays)."""
    return f"{SCRIMMAGE} AND ({stat.where}) AND {team_column(stat)} = $t"
