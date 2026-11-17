"""The box-score stats the dashboard shows, and which positions they belong to.

Column names are trusted constants from this file only; they are the one thing
the API ever formats into SQL. Everything a visitor sends is a bound parameter.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

StatGroup = Literal["passing", "rushing", "receiving", "defense"]


# Play rules. Trusted constants, like the column names; `$player` is always bound.
PASSER = "passer_player_id = $player"
RUSHER = "rusher_player_id = $player"
RECEIVER = "receiver_player_id = $player"
THROW = "pass_attempt = 1 AND sack = 0"

# Every stat's plays: real snaps only. Two-point tries and plays wiped out by a
# penalty ("no_play") don't count toward season stats.
PLAY_SCOPE = "coalesce(two_point_attempt, 0) = 0 AND coalesce(play_type, '') <> 'no_play'"


@dataclass(frozen=True, slots=True)
class Stat:
    key: str
    """Column in player_weeks."""
    label: str
    short: str
    group: StatGroup
    decimals: int = 0
    plays: str = "FALSE"
    """Which rows of the `plays` view count toward this stat for player `$player`."""
    play_value: str = "1"
    """What one of those plays adds to the total."""
    scope: str = PLAY_SCOPE
    """Which snaps count at all (nflverse's passing EPA keeps two-point tries)."""

    @property
    def side(self) -> Literal["offense", "defense"]:
        return "defense" if self.group == "defense" else "offense"


STATS: tuple[Stat, ...] = (
    Stat("completions", "Completions", "CMP", "passing", plays=f"{PASSER} AND complete_pass = 1"),
    Stat("attempts", "Pass attempts", "ATT", "passing", plays=f"{PASSER} AND {THROW}"),
    Stat(
        "passing_yards",
        "Passing yards",
        "YDS",
        "passing",
        plays=f"{PASSER} AND complete_pass = 1",
        play_value="coalesce(passing_yards, 0)",
    ),
    Stat(
        "passing_tds",
        "Passing touchdowns",
        "TD",
        "passing",
        plays=f"{PASSER} AND pass_touchdown = 1",
    ),
    Stat(
        "passing_interceptions",
        "Interceptions thrown",
        "INT",
        "passing",
        plays=f"{PASSER} AND interception = 1",
    ),
    Stat("sacks_suffered", "Sacks taken", "SK", "passing", plays=f"{PASSER} AND sack = 1"),
    Stat(
        "passing_epa",
        "Passing EPA",
        "EPA",
        "passing",
        1,
        plays=f"{PASSER} AND (pass_attempt = 1 OR sack = 1) AND qb_epa IS NOT NULL",
        play_value="qb_epa",
        scope="TRUE",
    ),
    Stat("carries", "Carries", "CAR", "rushing", plays=f"{RUSHER} AND rush_attempt = 1"),
    Stat(
        "rushing_yards",
        "Rushing yards",
        "YDS",
        "rushing",
        plays=f"(({RUSHER} AND rush_attempt = 1) OR lateral_rusher_player_id = $player)",
        play_value=(
            "CASE WHEN rusher_player_id = $player THEN coalesce(rushing_yards, 0) ELSE 0 END"
            " + CASE WHEN lateral_rusher_player_id = $player"
            " THEN coalesce(lateral_rushing_yards, 0) ELSE 0 END"
        ),
    ),
    Stat(
        "rushing_tds",
        "Rushing touchdowns",
        "TD",
        "rushing",
        plays=f"{RUSHER} AND rush_touchdown = 1",
    ),
    Stat("targets", "Targets", "TGT", "receiving", plays=f"{RECEIVER} AND {THROW}"),
    Stat("receptions", "Receptions", "REC", "receiving", plays=f"{RECEIVER} AND complete_pass = 1"),
    Stat(
        "receiving_yards",
        "Receiving yards",
        "YDS",
        "receiving",
        plays=f"(({RECEIVER} AND complete_pass = 1) OR lateral_receiver_player_id = $player)",
        play_value=(
            "CASE WHEN receiver_player_id = $player THEN coalesce(receiving_yards, 0) ELSE 0 END"
            " + CASE WHEN lateral_receiver_player_id = $player"
            " THEN coalesce(lateral_receiving_yards, 0) ELSE 0 END"
        ),
    ),
    Stat(
        "receiving_tds",
        "Receiving touchdowns",
        "TD",
        "receiving",
        plays="pass_touchdown = 1 AND td_player_id = $player",
    ),
    Stat(
        "receiving_air_yards",
        "Air yards",
        "AIR",
        "receiving",
        plays=f"{RECEIVER} AND {THROW} AND air_yards IS NOT NULL",
        play_value="air_yards",
    ),
    Stat(
        "def_tackles_solo",
        "Solo tackles",
        "SOLO",
        "defense",
        plays="(solo_tackle_1_player_id = $player OR solo_tackle_2_player_id = $player)",
    ),
    Stat(
        "def_sacks",
        "Sacks",
        "SACK",
        "defense",
        1,
        plays=(
            "(sack_player_id = $player OR half_sack_1_player_id = $player"
            " OR half_sack_2_player_id = $player)"
        ),
        play_value="CASE WHEN sack_player_id = $player THEN 1.0 ELSE 0.5 END",
    ),
    Stat(
        "def_qb_hits",
        "QB hits",
        "HITS",
        "defense",
        plays="(qb_hit_1_player_id = $player OR qb_hit_2_player_id = $player)",
    ),
    Stat(
        "def_interceptions",
        "Interceptions",
        "INT",
        "defense",
        plays="interception_player_id = $player",
    ),
    Stat(
        "def_pass_defended",
        "Passes defended",
        "PD",
        "defense",
        plays="(pass_defense_1_player_id = $player OR pass_defense_2_player_id = $player)",
    ),
)

STATS_BY_KEY = {s.key: s for s in STATS}

# What a player page leads with, by position group from the players table.
GROUPS_BY_POSITION: dict[str, tuple[StatGroup, ...]] = {
    "QB": ("passing", "rushing"),
    "RB": ("rushing", "receiving"),
    "WR": ("receiving", "rushing"),
    "TE": ("receiving",),
    "DL": ("defense",),
    "LB": ("defense",),
    "DB": ("defense",),
}


def groups_for(position_group: str | None) -> tuple[StatGroup, ...]:
    return GROUPS_BY_POSITION.get(position_group or "", ())


def stats_for(groups: tuple[StatGroup, ...]) -> list[Stat]:
    return [s for g in groups for s in STATS if s.group == g]
