"""Catalog of the nflverse datasets we load.

Each dataset is published as Parquet on the nflverse-data GitHub releases page,
either one file per season or one file covering every season. File names and
first seasons were verified against the live release assets on 2026-11-16.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass

RELEASE_BASE_URL = "https://github.com/nflverse/nflverse-data/releases/download"


@dataclass(frozen=True, slots=True)
class Dataset:
    """One nflverse dataset and how it maps to a raw DuckDB table."""

    name: str
    """Short key, also the cache sub-folder name."""
    table: str
    """Raw table it loads into."""
    release_tag: str
    """GitHub release tag that hosts the files."""
    file_pattern: str
    """File name; `{season}` is replaced for per-season datasets."""
    first_season: int | None = None
    """First season published. None means a single all-seasons file."""
    description: str = ""

    @property
    def per_season(self) -> bool:
        return self.first_season is not None

    def file_name(self, season: int | None = None) -> str:
        if self.per_season:
            if season is None:
                raise ValueError(f"{self.name} is per-season; a season is required")
            return self.file_pattern.format(season=season)
        return self.file_pattern

    def url(self, season: int | None = None) -> str:
        return f"{RELEASE_BASE_URL}/{self.release_tag}/{self.file_name(season)}"

    def seasons(self, first: int, current: int) -> list[int]:
        """Seasons to fetch for this dataset within the configured range."""
        if not self.per_season:
            return []
        assert self.first_season is not None
        return list(range(max(first, self.first_season), current + 1))


DATASETS: tuple[Dataset, ...] = (
    Dataset(
        name="pbp",
        table="raw_pbp",
        release_tag="pbp",
        file_pattern="play_by_play_{season}.parquet",
        first_season=1999,
        description="Every play: situation, result, EPA, players involved.",
    ),
    Dataset(
        name="ftn",
        table="raw_ftn",
        release_tag="ftn_charting",
        file_pattern="ftn_charting_{season}.parquet",
        first_season=2022,
        description="FTN Data hand charting (CC-BY-SA 4.0, credit 'FTN Data via nflverse').",
    ),
    Dataset(
        name="player_week",
        table="raw_player_week",
        release_tag="stats_player",
        file_pattern="stats_player_week_{season}.parquet",
        first_season=1999,
        description="Box-score totals per player per week.",
    ),
    Dataset(
        name="rosters",
        table="raw_rosters",
        release_tag="rosters",
        file_pattern="roster_{season}.parquet",
        first_season=1999,
        description="Season rosters with cross-site player IDs.",
    ),
    Dataset(
        name="snap_counts",
        table="raw_snap_counts",
        release_tag="snap_counts",
        file_pattern="snap_counts_{season}.parquet",
        first_season=2012,
        description="Offense, defense and special-teams snaps per player per game.",
    ),
    Dataset(
        name="injuries",
        table="raw_injuries",
        release_tag="injuries",
        file_pattern="injuries_{season}.parquet",
        first_season=2009,
        description="Weekly injury reports.",
    ),
    Dataset(
        name="players",
        table="raw_players",
        release_tag="players",
        file_pattern="players.parquet",
        description="Every player with IDs, position, bio and headshot.",
    ),
    Dataset(
        name="schedules",
        table="raw_schedules",
        release_tag="schedules",
        file_pattern="games.parquet",
        description="Every game: date, score, betting lines, weather, starting QBs.",
    ),
    Dataset(
        name="teams",
        table="raw_teams",
        release_tag="teams",
        file_pattern="teams_colors_logos.parquet",
        description="Every team: names, division, colours and logo links.",
    ),
    Dataset(
        name="ngs_passing",
        table="raw_ngs_passing",
        release_tag="nextgen_stats",
        file_pattern="ngs_passing.parquet",
        description="Next Gen Stats passing, weekly (week 0 = season total), 2016 on.",
    ),
    Dataset(
        name="ngs_receiving",
        table="raw_ngs_receiving",
        release_tag="nextgen_stats",
        file_pattern="ngs_receiving.parquet",
        description="Next Gen Stats receiving, weekly (week 0 = season total), 2016 on.",
    ),
    Dataset(
        name="ngs_rushing",
        table="raw_ngs_rushing",
        release_tag="nextgen_stats",
        file_pattern="ngs_rushing.parquet",
        description="Next Gen Stats rushing, weekly (week 0 = season total), 2016 on.",
    ),
)


@dataclass(frozen=True, slots=True)
class FileSpec:
    """One file to download."""

    dataset: Dataset
    season: int | None

    @property
    def url(self) -> str:
        return self.dataset.url(self.season)

    @property
    def file_name(self) -> str:
        return self.dataset.file_name(self.season)

    @property
    def label(self) -> str:
        return f"{self.dataset.name}/{self.file_name}"


def plan_files(
    first_season: int,
    current_season: int,
    *,
    current_only: bool,
    datasets: tuple[Dataset, ...] = DATASETS,
) -> Iterator[FileSpec]:
    """Yield the files a run should download.

    `current_only=True` (the daily refresh) fetches only current-season files plus
    the all-seasons files, which change every week. Past seasons come from cache.
    """
    for ds in datasets:
        if not ds.per_season:
            yield FileSpec(ds, None)
            continue
        for season in ds.seasons(first_season, current_season):
            if current_only and season != current_season:
                continue
            yield FileSpec(ds, season)


def get_dataset(name: str) -> Dataset:
    for ds in DATASETS:
        if ds.name == name:
            return ds
    raise KeyError(f"Unknown dataset {name!r}")
