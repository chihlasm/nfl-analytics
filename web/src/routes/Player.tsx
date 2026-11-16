import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { Notice, QueryState, Skeleton, errorText } from "../components/Notice";
import { Figure, PageHeader, Section } from "../components/Page";
import { TeamTag } from "../components/TeamMark";
import { WeekBars } from "../components/WeekBars";
import { ApiError, type MetricValue, type PlayerProfile, type StatColumn } from "../lib/api";
import { height, num, pct, signed, weekLabel } from "../lib/format";
import { usePlayer } from "../lib/queries";
import { team } from "../lib/teams";

/** The season figures a player's page leads with, in order of importance. */
const HEADLINE_STATS = [
  "passing_yards",
  "passing_tds",
  "passing_interceptions",
  "passing_epa",
  "rushing_yards",
  "rushing_tds",
  "receptions",
  "receiving_yards",
  "receiving_tds",
  "targets",
  "carries",
  "def_tackles_solo",
  "def_sacks",
  "def_interceptions",
  "def_pass_defended",
];

export function Player() {
  const { id } = useParams();
  const [season, setSeason] = useState<number | undefined>(undefined);
  const player = usePlayer(id, season);
  const p = player.data;

  if (player.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <div className="tile h-20 animate-pulse" aria-hidden="true" />
        <Skeleton rows={3} className="h-40" />
      </div>
    );
  }
  if (player.error || !p) {
    const missing = player.error instanceof ApiError && player.error.status === 404;
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <Notice tone="alert">{missing ? "We couldn't find that player." : errorText(player.error)}</Notice>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-6 ${player.isPlaceholderData ? "opacity-70" : ""}`}>
      <BackLink />
      <PageHeader title={p.player.display_name}>
        <BioLine profile={p} />
      </PageHeader>

      {p.seasons.length > 1 && (
        <div className="scroll-row -mx-1 px-1" role="group" aria-label="Season">
          {p.seasons.map((s) => (
            <button key={s} type="button" className="chip" aria-pressed={s === p.season} onClick={() => setSeason(s)}>
              <span className="figures">{s}</span>
            </button>
          ))}
        </div>
      )}

      {p.columns.length === 0 ? (
        <Notice>We don't track box-score stats for this position yet.</Notice>
      ) : p.season == null ? (
        <Notice>No games on record for this player since 1999.</Notice>
      ) : (
        <>
          <SeasonHero profile={p} />
          {p.metrics.length > 0 && <Accuracy metrics={p.metrics} season={p.season} />}
          <WeeklyChart profile={p} />
          <GameLog profile={p} />
          {p.career.length > 1 && <Career profile={p} />}
        </>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/players" className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-muted hover:text-ink">
      <ArrowLeft size={16} aria-hidden="true" />
      Players
    </Link>
  );
}

function BioLine({ profile }: { profile: PlayerProfile }) {
  const { player } = profile;
  const parts = [
    profile.years_of_experience != null ? `${profile.years_of_experience} yrs in the league` : null,
    profile.college,
    [height(profile.height_in), profile.weight_lb ? `${profile.weight_lb} lb` : null].filter(Boolean).join(", ") || null,
    profile.draft ? `Drafted ${profile.draft}` : null,
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-x-2 text-ink">
        <span>{player.position}</span>
        {player.team && (
          <>
            <span aria-hidden="true">·</span>
            <TeamTag abbr={player.team} />
            <span className="hidden sm:inline">{team(player.team)?.short}</span>
          </>
        )}
      </span>
      {parts.length > 0 && <span className="text-sm">{parts.join(" · ")}</span>}
    </div>
  );
}

function headline(columns: StatColumn[]): StatColumn[] {
  const byKey = new Map(columns.map((c) => [c.key, c]));
  return HEADLINE_STATS.map((k) => byKey.get(k)).filter((c): c is StatColumn => Boolean(c)).slice(0, 4);
}

function SeasonHero({ profile }: { profile: PlayerProfile }) {
  const games = profile.weeks.filter((w) => w.season_type === "REG").length;
  return (
    <section aria-label={`${profile.season} regular season`} className="card-inverse flex flex-col gap-5 p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xl font-semibold">{profile.season} regular season</h2>
        <span className="text-sm text-hero-muted">
          <span className="figures">{games}</span> games
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
        {headline(profile.columns).map((c) => (
          <Figure key={c.key} label={<span className="text-hero-muted">{c.label}</span>} value={num(profile.totals[c.key], c.decimals)} />
        ))}
      </div>
    </section>
  );
}

function metricValue(m: MetricValue): string {
  if (m.unit === "rate") return pct(m.value);
  if (m.unit === "epa") return signed(m.value);
  return num(m.value);
}

function Accuracy({ metrics, season }: { metrics: MetricValue[]; season: number }) {
  const receiver = metrics.every((m) => m.name === "receiver_drops");
  return (
    <Section
      title={receiver ? "Hands" : "Accuracy"}
      description={
        <>
          From FTN's hand charting of every {season} play. The latest week fills in a day or two after the game.
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {metrics.map((m) => (
          <div key={m.name} className="tile flex flex-col gap-2 p-4">
            <Figure label={m.label} value={metricValue(m)} />
            <p className="text-sm text-muted">{m.description}</p>
            {m.denominator != null && (
              <p className="figures text-xs text-faint">
                {num(m.numerator)} of {num(m.denominator)} plays
              </p>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

function WeeklyChart({ profile }: { profile: PlayerProfile }) {
  const options = headline(profile.columns);
  const [key, setKey] = useState<string | undefined>(undefined);
  const stat = options.find((c) => c.key === key) ?? options[0];
  if (!stat || profile.weeks.length === 0) return null;
  const bars = profile.weeks.map((w) => ({
    label: w.season_type === "POST" ? weekLabel(w.week, "POST", profile.season ?? undefined).split(" ")[0] ?? "P" : `W${w.week}`,
    sub: w.opponent ?? undefined,
    value: w.stats[stat.key] ?? null,
  }));
  return (
    <Section title="Week by week">
      <div className="scroll-row -mx-1 px-1" role="group" aria-label="Stat to chart">
        {options.map((c) => (
          <button key={c.key} type="button" className="chip" aria-pressed={c.key === stat.key} onClick={() => setKey(c.key)}>
            {c.label}
          </button>
        ))}
      </div>
      <WeekBars bars={bars} decimals={stat.decimals} label={`${stat.label} by week, ${profile.season}`} />
    </Section>
  );
}

const GROUP_LABEL: Record<string, string> = {
  passing: "Passing",
  rushing: "Rushing",
  receiving: "Receiving",
  defense: "Defense",
};

/** Header cells naming each stat group over its columns ("Passing", "Rushing"). */
function GroupHeader({ columns, lead }: { columns: StatColumn[]; lead: number }) {
  const spans: Array<{ group: string; span: number }> = [];
  for (const c of columns) {
    const last = spans.at(-1);
    if (last && last.group === c.group) last.span += 1;
    else spans.push({ group: c.group, span: 1 });
  }
  if (spans.length < 2) return null;
  return (
    <tr>
      <th colSpan={lead} aria-hidden="true" className="!border-b-0" />
      {spans.map((s, i) => (
        <th key={`${s.group}-${i}`} colSpan={s.span} scope="colgroup" className="!border-b-0 !text-left text-ink">
          {GROUP_LABEL[s.group] ?? s.group}
        </th>
      ))}
    </tr>
  );
}

function GameLog({ profile }: { profile: PlayerProfile }) {
  const cols = profile.columns;
  return (
    <Section title="Game log" description="Regular season totals at the bottom.">
      <QueryState isPending={false} error={null} empty={profile.weeks.length === 0} emptyText="No games this season.">
        <div className="-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
          <table className="data-table figures">
            <thead>
              <GroupHeader columns={cols} lead={3} />
              <tr>
                <th scope="col">Week</th>
                <th scope="col">Opp</th>
                <th scope="col" title="Share of the team's snaps played">
                  Snaps
                </th>
                {cols.map((c) => (
                  <th key={c.key} scope="col" title={c.label}>
                    {c.short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {profile.weeks.map((w) => (
                <tr key={`${w.season_type}-${w.week}`}>
                  <td>
                    {weekLabel(w.week, w.season_type, profile.season ?? undefined)}
                    {w.injury_status && (
                      <span className="ml-2 text-xs text-warn" title={`Injury report: ${w.injury_status}`}>
                        {w.injury_status[0]}
                      </span>
                    )}
                  </td>
                  <td>
                    <TeamTag abbr={w.opponent} className="justify-end" />
                  </td>
                  <td>{w.snap_pct == null ? "–" : pct(w.snap_pct, 0)}</td>
                  {cols.map((c) => (
                    <td key={c.key}>{num(w.stats[c.key], c.decimals)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Season</td>
                <td />
                <td />
                {cols.map((c) => (
                  <td key={c.key}>{num(profile.totals[c.key], c.decimals)}</td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </QueryState>
    </Section>
  );
}

function Career({ profile }: { profile: PlayerProfile }) {
  const cols = profile.columns;
  return (
    <Section title="Career" description="Regular season, by year.">
      <div className="-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
        <table className="data-table figures">
          <thead>
            <GroupHeader columns={cols} lead={3} />
            <tr>
              <th scope="col">Season</th>
              <th scope="col">Team</th>
              <th scope="col">G</th>
              {cols.map((c) => (
                <th key={c.key} scope="col" title={c.label}>
                  {c.short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {profile.career.map((s) => (
              <tr key={s.season}>
                <td>{s.season}</td>
                <td>
                  <TeamTag abbr={s.team} className="justify-end" />
                </td>
                <td>{s.games}</td>
                {cols.map((c) => (
                  <td key={c.key}>{num(s.stats[c.key], c.decimals)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
