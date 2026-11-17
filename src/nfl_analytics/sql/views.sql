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
-- ;;

-- ---------------------------------------------------------------------------
-- injury_reports: one row per player per week on the official injury report
-- (2009 on). Rows with no game status (practice-only listings) are kept, with
-- report_status NULL, so practice participation is still visible.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW injury_reports AS
SELECT
    i.season,
    i.season_type,
    i.week,
    i.team,
    i.gsis_id                   AS player_id,
    i.full_name                 AS player_name,
    i.position,
    i.report_status,
    i.report_primary_injury     AS primary_injury,
    i.report_secondary_injury   AS secondary_injury,
    i.practice_status,
    i.practice_primary_injury
FROM raw_injuries AS i;
-- ;;

-- ---------------------------------------------------------------------------
-- teams: one row per current team abbreviation, as nflverse uses them.
-- The nflverse file also lists historical abbreviations (OAK, SD, STL, LAR);
-- logo_url is the official ESPN logo the ingest job caches locally.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW teams AS
SELECT
    team_abbr          AS team,
    team_name          AS name,
    team_nick          AS nickname,
    team_conf          AS conference,
    team_division      AS division,
    team_color         AS color_primary,
    team_color2        AS color_secondary,
    team_logo_espn     AS logo_url
FROM raw_teams;
-- ;;

-- ---------------------------------------------------------------------------
-- team_games: every game twice, once from each team's side.
-- team_line is the betting spread from this team's point of view
-- (negative = favoured), converted from nflverse's home-team spread_line.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW team_games AS
SELECT
    g.game_id,
    g.season,
    g.game_type,
    g.week,
    g.game_date,
    g.kickoff_time_et,
    s.team,
    s.opponent,
    s.is_home,
    s.points_for,
    s.points_against,
    CASE
        WHEN NOT g.is_final               THEN NULL
        WHEN s.points_for > s.points_against THEN 'W'
        WHEN s.points_for < s.points_against THEN 'L'
        ELSE 'T'
    END                                   AS result,
    g.is_final,
    coalesce(g.is_overtime, FALSE)        AS is_overtime,
    coalesce(g.is_division_game, FALSE)   AS is_division_game,
    CASE WHEN s.is_home THEN -g.spread_line ELSE g.spread_line END AS team_line,
    g.total_line,
    s.qb_name,
    s.opponent_qb_name
FROM games AS g
CROSS JOIN LATERAL (
    SELECT g.home_team AS team, g.away_team AS opponent, TRUE AS is_home,
           g.home_score AS points_for, g.away_score AS points_against,
           g.home_qb_name AS qb_name, g.away_qb_name AS opponent_qb_name
    UNION ALL
    SELECT g.away_team, g.home_team, FALSE,
           g.away_score, g.home_score,
           g.away_qb_name, g.home_qb_name
) AS s;
-- ;;

-- ---------------------------------------------------------------------------
-- team_weeks: per team per game, what its offense did and what its defense
-- allowed. Scrimmage plays only (pass and run; sacks count as passes, as in
-- nflverse). Kneels, spikes, two-point tries and penalties without a play
-- are left out.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW team_weeks AS
WITH scrimmage AS (
    SELECT *
    FROM plays
    WHERE play_type IN ('pass', 'run')
      AND coalesce(two_point_attempt, 0) = 0
      AND posteam IS NOT NULL
),
side AS (
    SELECT
        season, season_type, week, game_id, posteam AS team, defteam AS opponent,
        count(*)                                                  AS plays,
        sum(yards_gained)                                         AS yards,
        sum(epa)                                                  AS epa,
        sum(success)                                              AS successes,
        sum(yards_gained) FILTER (WHERE play_type = 'pass')       AS pass_yards,
        sum(yards_gained) FILTER (WHERE play_type = 'run')        AS rush_yards,
        sum(coalesce(interception, 0) + coalesce(fumble_lost, 0)) AS turnovers
    FROM scrimmage
    GROUP BY ALL
),
-- Every team in every game, even if only one side's plays are present.
keys AS (
    SELECT season, season_type, week, game_id, team, opponent FROM side
    UNION
    SELECT season, season_type, week, game_id, opponent, team FROM side
)
SELECT
    k.season, k.season_type, k.week, k.game_id, k.team, k.opponent,
    o.plays       AS off_plays,
    o.yards       AS off_yards,
    o.epa         AS off_epa,
    o.successes   AS off_successes,
    o.pass_yards  AS off_pass_yards,
    o.rush_yards  AS off_rush_yards,
    o.turnovers   AS giveaways,
    d.plays       AS def_plays,
    d.yards       AS def_yards,
    d.epa         AS def_epa,
    d.successes   AS def_successes,
    d.pass_yards  AS def_pass_yards,
    d.rush_yards  AS def_rush_yards,
    d.turnovers   AS takeaways
FROM keys AS k
LEFT JOIN side AS o
    ON  o.season = k.season AND o.season_type = k.season_type AND o.week = k.week
    AND o.game_id = k.game_id AND o.team = k.team
LEFT JOIN side AS d
    ON  d.season = k.season AND d.season_type = k.season_type AND d.week = k.week
    AND d.game_id = k.game_id AND d.team = k.opponent;
