-- Clean views over the raw_* tables.
--
-- The dashboard, the API and the MCP server query ONLY these views. When nflverse
-- renames or adds a column, the fix happens here and nothing downstream changes.
-- Statements are separated by a line containing only `-- ;;` so the builder can
-- run them one at a time and report exactly which view failed.

-- ---------------------------------------------------------------------------
-- plays: one row per play, play-by-play joined to FTN charting (2022 on).
-- FTN columns are NULL for plays that were not charted (all seasons before 2022).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW plays AS
SELECT
    p.*,
    f.* EXCLUDE (nflverse_game_id, nflverse_play_id, season, week, date_pulled),
    f.ftn_play_id IS NOT NULL                              AS is_charted,
    coalesce(p.air_yards <= 15, FALSE)                     AS is_short_pass,
    CASE
        WHEN p.air_yards IS NULL THEN NULL
        WHEN p.air_yards < 0     THEN 'behind_los'
        WHEN p.air_yards < 10    THEN 'short'
        WHEN p.air_yards < 20    THEN 'intermediate'
        ELSE 'deep'
    END                                                    AS depth_bucket,
    f.n_blitzers > 0                                       AS is_blitz
FROM raw_pbp AS p
LEFT JOIN raw_ftn AS f
    ON f.nflverse_game_id = p.game_id
   AND f.nflverse_play_id = p.play_id;
-- ;;

-- ---------------------------------------------------------------------------
-- dropbacks: every QB dropback (pass attempts, sacks, scrambles) with the
-- accuracy flags the saved metrics are built from.
--
-- Accuracy flags need FTN charting, so they are NULL before 2022.
--   is_pass_attempt            a real throw (not a sack, not a spike)
--   is_inaccurate_incompletion incomplete, charted NOT catchable, not a throwaway
--   is_short_throw_miss        the above, on a throw of 15 air yards or less
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW dropbacks AS
SELECT
    pl.*,
    pl.pass_attempt = 1 AND pl.sack = 0 AND coalesce(pl.qb_spike, 0) = 0
        AS is_pass_attempt,
    CASE WHEN pl.is_charted THEN
        pl.pass_attempt = 1 AND pl.sack = 0 AND coalesce(pl.qb_spike, 0) = 0
        AND pl.incomplete_pass = 1
        AND pl.is_catchable_ball = FALSE
        AND coalesce(pl.is_throw_away, FALSE) = FALSE
    END AS is_inaccurate_incompletion,
    CASE WHEN pl.is_charted THEN
        pl.pass_attempt = 1 AND pl.sack = 0 AND coalesce(pl.qb_spike, 0) = 0
        AND pl.incomplete_pass = 1
        AND pl.is_catchable_ball = FALSE
        AND coalesce(pl.is_throw_away, FALSE) = FALSE
        AND pl.air_yards IS NOT NULL AND pl.air_yards <= 15
    END AS is_short_throw_miss
FROM plays AS pl
WHERE pl.qb_dropback = 1;
-- ;;

-- ---------------------------------------------------------------------------
-- targets: one row per pass thrown to a receiver.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW targets AS
SELECT pl.*
FROM plays AS pl
WHERE pl.pass_attempt = 1
  AND pl.sack = 0
  AND pl.receiver_player_id IS NOT NULL;
-- ;;

-- ---------------------------------------------------------------------------
-- games: one row per game, 1999 on.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW games AS
SELECT
    game_id,
    season,
    game_type,
    week,
    TRY_CAST(gameday AS DATE)     AS game_date,
    weekday,
    gametime                      AS kickoff_time_et,
    home_team,
    away_team,
    home_score,
    away_score,
    result                        AS home_margin,
    total                         AS total_points,
    overtime = 1                  AS is_overtime,
    home_score IS NOT NULL        AS is_final,
    spread_line,
    total_line,
    home_moneyline,
    away_moneyline,
    div_game = 1                  AS is_division_game,
    roof,
    surface,
    temp                          AS temp_f,
    wind                          AS wind_mph,
    stadium,
    home_qb_id,
    home_qb_name,
    away_qb_id,
    away_qb_name,
    home_coach,
    away_coach,
    referee
FROM raw_schedules
WHERE season >= 1999;
-- ;;

-- ---------------------------------------------------------------------------
-- players: one row per player, keyed by the GSIS ID used everywhere else.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW players AS
SELECT
    gsis_id               AS player_id,
    display_name,
    first_name,
    last_name,
    short_name,
    football_name,
    position,
    position_group,
    latest_team           AS team,
    status,
    jersey_number,
    height                AS height_in,
    weight                AS weight_lb,
    birth_date,
    college_name          AS college,
    rookie_season,
    last_season,
    years_of_experience,
    draft_year,
    draft_round,
    draft_pick,
    draft_team,
    headshot              AS headshot_url,
    pfr_id,
    espn_id,
    pff_id,
    nfl_id
FROM raw_players
WHERE gsis_id IS NOT NULL;
-- ;;

-- ---------------------------------------------------------------------------
-- player_weeks: one row per player per week (exactly the rows of
-- raw_player_week), with snaps, injury report and Next Gen Stats attached.
-- NGS week 0 rows are season totals and are excluded here.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW player_weeks AS
WITH pfr_map AS (
    SELECT pfr_id, any_value(gsis_id) AS player_id
    FROM raw_players
    WHERE pfr_id IS NOT NULL AND gsis_id IS NOT NULL
    GROUP BY pfr_id
),
snaps AS (
    SELECT
        m.player_id, s.season, s.week,
        sum(s.offense_snaps) AS offense_snaps, max(s.offense_pct) AS offense_snap_pct,
        sum(s.defense_snaps) AS defense_snaps, max(s.defense_pct) AS defense_snap_pct,
        sum(s.st_snaps)      AS st_snaps,      max(s.st_pct)      AS st_snap_pct
    FROM raw_snap_counts AS s
    JOIN pfr_map AS m ON m.pfr_id = s.pfr_player_id
    GROUP BY ALL
),
injury AS (
    SELECT
        gsis_id AS player_id, season, week,
        any_value(report_status)          AS injury_report_status,
        any_value(report_primary_injury)  AS injury_primary,
        any_value(practice_status)        AS injury_practice_status
    FROM raw_injuries
    WHERE gsis_id IS NOT NULL
    GROUP BY ALL
),
ngs_pass AS (
    SELECT
        player_gsis_id AS player_id, season, week,
        any_value(avg_time_to_throw)                         AS ngs_avg_time_to_throw,
        any_value(aggressiveness)                            AS ngs_aggressiveness,
        any_value(avg_intended_air_yards)                    AS ngs_avg_intended_air_yards,
        any_value(completion_percentage_above_expectation)   AS ngs_cpoe
    FROM raw_ngs_passing
    WHERE week > 0
    GROUP BY ALL
),
ngs_rec AS (
    SELECT
        player_gsis_id AS player_id, season, week,
        any_value(avg_separation)               AS ngs_avg_separation,
        any_value(avg_cushion)                  AS ngs_avg_cushion,
        any_value(avg_yac_above_expectation)    AS ngs_yac_above_expected
    FROM raw_ngs_receiving
    WHERE week > 0
    GROUP BY ALL
),
ngs_rush AS (
    SELECT
        player_gsis_id AS player_id, season, week,
        any_value(efficiency)                              AS ngs_rush_efficiency,
        any_value(rush_yards_over_expected)                AS ngs_rush_yards_over_expected,
        any_value(percent_attempts_gte_eight_defenders)    AS ngs_pct_vs_eight_in_box
    FROM raw_ngs_rushing
    WHERE week > 0
    GROUP BY ALL
)
SELECT
    w.*,
    snaps.* EXCLUDE (player_id, season, week),
    injury.* EXCLUDE (player_id, season, week),
    ngs_pass.* EXCLUDE (player_id, season, week),
    ngs_rec.* EXCLUDE (player_id, season, week),
    ngs_rush.* EXCLUDE (player_id, season, week)
FROM raw_player_week AS w
LEFT JOIN snaps    USING (player_id, season, week)
LEFT JOIN injury   USING (player_id, season, week)
LEFT JOIN ngs_pass USING (player_id, season, week)
LEFT JOIN ngs_rec  USING (player_id, season, week)
LEFT JOIN ngs_rush USING (player_id, season, week);
