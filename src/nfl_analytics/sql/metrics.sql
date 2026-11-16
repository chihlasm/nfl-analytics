-- Saved metrics: each one is defined ONCE here, so the dashboard, the API and
-- Claude (through the MCP server) always count the same way.
--
-- A metric = `aggregate` over the rows of `source_view` that match `row_filter`.
-- When `denominator_filter` is set, the result is that value divided by the count
-- of rows matching the denominator filter (a rate between 0 and 1).
-- Statements are separated by `-- ;;` (see views.sql).

CREATE OR REPLACE TABLE metric_definitions (
    name                VARCHAR PRIMARY KEY,
    label               VARCHAR NOT NULL,
    description         VARCHAR NOT NULL,
    source_view         VARCHAR NOT NULL,
    player_column       VARCHAR NOT NULL,
    row_filter          VARCHAR NOT NULL,
    aggregate           VARCHAR NOT NULL,
    denominator_filter  VARCHAR,
    first_season        INTEGER NOT NULL,
    unit                VARCHAR NOT NULL
);
-- ;;

INSERT INTO metric_definitions VALUES
(
    'short_throw_misses',
    'Short-throw misses',
    'Incomplete passes of 15 air yards or less that FTN charted as not catchable, '
    || 'excluding throwaways, spikes and sacks. The quarterback missed a makeable throw.',
    'dropbacks', 'passer_player_id',
    'is_short_throw_miss', 'count(*)',
    NULL,
    2022, 'count'
),
(
    'short_throw_miss_rate',
    'Short-throw miss rate',
    'Short-throw misses as a share of all pass attempts of 15 air yards or less.',
    'dropbacks', 'passer_player_id',
    'is_short_throw_miss', 'count(*)',
    'is_pass_attempt AND is_short_pass',
    2022, 'rate'
),
(
    'inaccurate_incompletions',
    'Inaccurate incompletions',
    'Incomplete passes at any depth charted as not catchable, excluding throwaways.',
    'dropbacks', 'passer_player_id',
    'is_inaccurate_incompletion', 'count(*)',
    NULL,
    2022, 'count'
),
(
    'catchable_ball_rate',
    'Catchable-ball rate',
    'Share of pass attempts (excluding throwaways) that FTN charted as catchable.',
    'dropbacks', 'passer_player_id',
    'is_pass_attempt AND is_catchable_ball AND NOT coalesce(is_throw_away, FALSE)', 'count(*)',
    'is_pass_attempt AND is_charted AND NOT coalesce(is_throw_away, FALSE)',
    2022, 'rate'
),
(
    'receiver_drops',
    'Drops',
    'Targets the receiver dropped (FTN charting).',
    'targets', 'receiver_player_id',
    'coalesce(is_drop, FALSE)', 'count(*)',
    NULL,
    2022, 'count'
),
(
    'epa_per_dropback',
    'EPA per dropback',
    'Average expected points added per QB dropback.',
    'dropbacks', 'passer_player_id',
    'epa IS NOT NULL', 'avg(epa)',
    NULL,
    1999, 'epa'
);
