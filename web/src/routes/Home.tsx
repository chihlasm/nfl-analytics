import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { Notice, QueryState } from "../components/Notice";
import { PageHeader, Section } from "../components/Page";
import { TeamMark, TeamTag } from "../components/TeamMark";
import type { Game, InjuryStatus, TeamScore } from "../lib/api";
import { ago, kickoff, num, shortDate, weekLabel } from "../lib/format";
import { useInjuries, useLeaders, useMeta, useNews, useWeek } from "../lib/queries";
import { team } from "../lib/teams";

export function Home() {
  const meta = useMeta();
  const season = meta.data?.current_season;
  const [week, setWeek] = useState<number | undefined>(undefined);
  const games = useWeek(season, week);
  const shown = games.data;

  const weeks = shown?.weeks ?? [];
  const index = shown ? weeks.indexOf(shown.week) : -1;
  const prev = index > 0 ? weeks[index - 1] : undefined;
  const next = index >= 0 && index < weeks.length - 1 ? weeks[index + 1] : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={shown ? weekLabel(shown.week, shown.games[0]?.game_type === "REG" ? "REG" : "POST", shown.season) : "This week"}
        action={
          shown && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn btn-quiet btn-icon"
                disabled={prev === undefined}
                onClick={() => setWeek(prev)}
                aria-label={prev !== undefined ? `Show week ${prev}` : "No earlier week"}
              >
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="btn btn-quiet btn-icon"
                disabled={next === undefined}
                onClick={() => setWeek(next)}
                aria-label={next !== undefined ? `Show week ${next}` : "No later week"}
              >
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </div>
          )
        }
      >
        {season && (
          <>
            {season} season
            {meta.data && <> · stats updated {ago(meta.data.built_at).toLowerCase()}</>}
          </>
        )}
      </PageHeader>

      <Section title="Scores" aside={shown && <span className="text-muted">{shown.games.length} games</span>}>
        <QueryState
          isPending={games.isPending || meta.isPending}
          error={games.error ?? meta.error}
          empty={shown?.games.length === 0}
          emptyText="No games scheduled this week."
          rows={4}
        >
          <ul className={`grid gap-3 sm:grid-cols-2 ${games.isPlaceholderData ? "opacity-60" : ""}`}>
            {shown?.games.map((g) => (
              <li key={g.game_id}>
                <GameTile game={g} />
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">Scores and stats refresh once a day, early each morning.</p>
        </QueryState>
      </Section>

      <Headlines />

      <div className="grid gap-6 lg:grid-cols-2">
        <LeadersCard season={season} />
        <InjuryCard season={season} />
      </div>
    </div>
  );
}

function GameTile({ game }: { game: Game }) {
  const { home, away, is_final } = game;
  const awayWon = is_final && (away.score ?? 0) > (home.score ?? 0);
  const homeWon = is_final && (home.score ?? 0) > (away.score ?? 0);
  const status = is_final ? (game.is_overtime ? "Final/OT" : "Final") : kickoff(game.kickoff_time_et);
  return (
    <article className="tile flex flex-col gap-3 p-4" aria-label={`${team(away.team)?.name ?? away.team} at ${team(home.team)?.name ?? home.team}`}>
      <div className="flex items-center justify-between text-xs font-medium text-muted">
        <span>{shortDate(game.game_date)}</span>
        <span className={is_final ? "text-ink" : ""}>{status}</span>
      </div>
      <TeamLine side={away} won={awayWon} final={is_final} />
      <TeamLine side={home} won={homeWon} final={is_final} home />
      {!is_final && game.spread_line != null && (
        <p className="text-xs text-muted">
          {game.spread_line === 0
            ? "Pick'em"
            : `${game.spread_line > 0 ? home.team : away.team} by ${Math.abs(game.spread_line)}`}
          {game.total_line != null && <> · O/U {game.total_line}</>}
        </p>
      )}
    </article>
  );
}

function TeamLine({ side, won, final, home = false }: { side: TeamScore; won: boolean; final: boolean; home?: boolean }) {
  const t = team(side.team);
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <TeamMark abbr={side.team} size={16} />
        <div className="flex min-w-0 flex-col">
          <span className={`truncate ${won ? "font-semibold" : final ? "text-muted" : "font-medium"}`}>
            {t?.short ?? side.team}
            {home && <span className="sr-only"> (home)</span>}
          </span>
          {side.qb_name && <span className="truncate text-xs text-faint">{side.qb_name}</span>}
        </div>
      </div>
      {side.score != null && (
        <span className={`figures font-display text-2xl leading-none ${won ? "font-bold" : "text-muted"}`}>{side.score}</span>
      )}
    </div>
  );
}

function Headlines() {
  const news = useNews();
  const [all, setAll] = useState(false);
  const items = news.data?.items ?? [];
  const visible = all ? items : items.slice(0, 8);
  const failed = news.data?.sources_failed ?? [];

  return (
    <Section
      title="Headlines"
      aside={news.data?.fetched_at && <span className="text-muted">Updated {ago(news.data.fetched_at).toLowerCase()}</span>}
    >
      <QueryState
        isPending={news.isPending}
        error={news.error}
        empty={items.length === 0}
        emptyText={
          failed.length
            ? `Couldn't load headlines from ${failed.join(", ")}. They'll retry in 15 minutes.`
            : "Headlines are loading for the first time. Check back in a minute."
        }
        rows={5}
      >
        <ul className="flex flex-col">
          {visible.map((item) => (
            <li key={item.url} className="border-b border-line last:border-b-0">
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-start justify-between gap-3 py-3"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-medium group-hover:underline group-hover:underline-offset-4">{item.title}</span>
                  <span className="text-sm text-muted">
                    {item.source}
                    {item.published_at && <> · {ago(item.published_at)}</>}
                  </span>
                </span>
                <ExternalLink size={16} className="mt-1 shrink-0 text-faint" aria-hidden="true" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </li>
          ))}
        </ul>
        {items.length > 8 && (
          <button type="button" className="btn btn-quiet self-start" onClick={() => setAll((v) => !v)}>
            {all ? "Show fewer" : `Show all ${items.length}`}
          </button>
        )}
        {failed.length > 0 && items.length > 0 && (
          <Notice>Not loading right now: {failed.join(", ")}.</Notice>
        )}
      </QueryState>
    </Section>
  );
}

function LeadersCard({ season }: { season: number | undefined }) {
  const leaders = useLeaders(season);
  const boards = leaders.data?.boards ?? [];
  const [key, setKey] = useState<string | undefined>(undefined);
  const board = boards.find((b) => b.key === key) ?? boards[0];

  return (
    <Section
      title="League leaders"
      aside={leaders.data?.through_week && <span className="text-muted">Through week {leaders.data.through_week}</span>}
    >
      <QueryState isPending={leaders.isPending} error={leaders.error} empty={!board} rows={5}>
        <div className="scroll-row -mx-1 px-1" role="group" aria-label="Stat">
          {boards.map((b) => (
            <button
              key={b.key}
              type="button"
              className="chip"
              aria-pressed={b.key === board?.key}
              onClick={() => setKey(b.key)}
            >
              {b.label}
            </button>
          ))}
        </div>
        <ol className="flex flex-col">
          {board?.rows.map((r, i) => (
            <li key={r.player_id}>
              <Link
                to={`/players/${r.player_id}`}
                className="flex min-h-12 items-center gap-3 rounded-[var(--radius-control)] px-2 hover:bg-sunken"
              >
                <span className="figures w-5 text-right text-sm text-faint">{i + 1}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{r.name}</span>
                  <span className="flex items-center gap-2 text-xs text-muted">
                    {r.position}
                    <TeamTag abbr={r.team} />
                    <span>{r.games} games</span>
                  </span>
                </span>
                <span className="figures font-display text-xl font-bold">{num(r.value, board.decimals)}</span>
              </Link>
            </li>
          ))}
        </ol>
      </QueryState>
    </Section>
  );
}

const STATUS_TONE: Record<InjuryStatus, string> = {
  Out: "bg-[var(--color-alert-tint)] text-alert",
  Doubtful: "bg-[var(--color-warn-tint)] text-warn",
  Questionable: "bg-[var(--color-warn-tint)] text-warn",
};

function InjuryCard({ season }: { season: number | undefined }) {
  const injuries = useInjuries(season);
  const [status, setStatus] = useState<InjuryStatus>("Out");
  const [all, setAll] = useState(false);
  const rows = (injuries.data?.rows ?? []).filter((r) => r.status === status);
  const visible = all ? rows : rows.slice(0, 10);
  const counts = injuries.data?.counts;

  return (
    <Section
      title="Injury report"
      aside={injuries.data?.week && <span className="text-muted">Week {injuries.data.week}</span>}
    >
      <QueryState isPending={injuries.isPending} error={injuries.error} empty={!injuries.data?.week} rows={5}>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Game status">
          {(["Out", "Doubtful", "Questionable"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className="chip"
              aria-pressed={s === status}
              onClick={() => {
                setStatus(s);
                setAll(false);
              }}
            >
              {s}
              <span className="figures opacity-70">{counts?.[s] ?? 0}</span>
            </button>
          ))}
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">Nobody listed as {status.toLowerCase()} this week.</p>
        ) : (
          <ul className="flex flex-col">
            {visible.map((r) => {
              const name = <span className="truncate font-medium">{r.player_name}</span>;
              return (
                <li key={`${r.team}-${r.player_name}`} className="flex min-h-12 items-center justify-between gap-3 border-b border-line py-2 last:border-b-0">
                  <span className="flex min-w-0 flex-col">
                    {r.player_id ? (
                      <Link to={`/players/${r.player_id}`} className="truncate hover:underline hover:underline-offset-4">
                        {name}
                      </Link>
                    ) : (
                      name
                    )}
                    <span className="flex items-center gap-2 text-xs text-muted">
                      {r.position}
                      <TeamTag abbr={r.team} />
                      {r.injury && <span className="truncate">{r.injury}</span>}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_TONE[r.status]}`}>
                    {r.status}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {rows.length > 10 && (
          <button type="button" className="btn btn-quiet self-start" onClick={() => setAll((v) => !v)}>
            {all ? "Show fewer" : `Show all ${rows.length}`}
          </button>
        )}
      </QueryState>
    </Section>
  );
}
