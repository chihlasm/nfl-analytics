"""The box-score stats the dashboard shows, and which positions they belong to.

Column names are trusted constants from this file only; they are the one thing
the API ever formats into SQL. Everything a visitor sends is a bound parameter.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

StatGroup = Literal["passing", "rushing", "receiving", "defense"]


@dataclass(frozen=True, slots=True)
class Stat:
    key: str
    """Column in player_weeks."""
    label: str
    short: str
    group: StatGroup
    decimals: int = 0


STATS: tuple[Stat, ...] = (
    Stat("completions", "Completions", "CMP", "passing"),
    Stat("attempts", "Pass attempts", "ATT", "passing"),
    Stat("passing_yards", "Passing yards", "YDS", "passing"),
    Stat("passing_tds", "Passing touchdowns", "TD", "passing"),
    Stat("passing_interceptions", "Interceptions thrown", "INT", "passing"),
    Stat("sacks_suffered", "Sacks taken", "SK", "passing"),
    Stat("passing_epa", "Passing EPA", "EPA", "passing", 1),
    Stat("carries", "Carries", "CAR", "rushing"),
    Stat("rushing_yards", "Rushing yards", "YDS", "rushing"),
    Stat("rushing_tds", "Rushing touchdowns", "TD", "rushing"),
    Stat("targets", "Targets", "TGT", "receiving"),
    Stat("receptions", "Receptions", "REC", "receiving"),
    Stat("receiving_yards", "Receiving yards", "YDS", "receiving"),
    Stat("receiving_tds", "Receiving touchdowns", "TD", "receiving"),
    Stat("receiving_air_yards", "Air yards", "AIR", "receiving"),
    Stat("def_tackles_solo", "Solo tackles", "SOLO", "defense"),
    Stat("def_sacks", "Sacks", "SACK", "defense", 1),
    Stat("def_qb_hits", "QB hits", "HITS", "defense"),
    Stat("def_interceptions", "Interceptions", "INT", "defense"),
    Stat("def_pass_defended", "Passes defended", "PD", "defense"),
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

# League leader boards shown on the home page, in order.
LEADER_CATEGORIES: tuple[str, ...] = (
    "passing_yards",
    "passing_tds",
    "rushing_yards",
    "receiving_yards",
    "receptions",
    "def_sacks",
)


def groups_for(position_group: str | None) -> tuple[StatGroup, ...]:
    return GROUPS_BY_POSITION.get(position_group or "", ())


def stats_for(groups: tuple[StatGroup, ...]) -> list[Stat]:
    return [s for g in groups for s in STATS if s.group == g]
