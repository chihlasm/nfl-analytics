import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { QueryState } from "../components/Notice";
import { StandingsTable } from "../components/Standings";
import { TeamLink, TeamMark } from "../components/TeamMark";
import { ChipRow, Panel, Segmented, type Option } from "../components/ui";
import type { StandingRow } from "../lib/api";
import { signed, wlt } from "../lib/format";
import { useScreenTeam } from "../lib/palette";
import { useStandings } from "../lib/queries";
import { team } from "../lib/teams";

type View = "divisions" | "conferences" | "league";
const VIEWS: readonly Option<View>[] = [
  { key: "divisions", label: "Divisions" },
  { key: "conferences", label: "Conferences" },
  { key: "league", label: "League" },
];

const CONFERENCES = ["AFC", "NFC"] as const;
const DIVISION_ORDER = ["East", "North", "South", "West"];

export function Teams() {
  useScreenTeam(null);
  const [params, setParams] = useSearchParams();
  const asked = Number(params.get("season")) || undefined;
  const query = useStandings(asked);
  const [chosen, setView] = useState<View>("divisions");
  const s = query.data;
  const view: View = s && !s.divisions_apply ? "league" : chosen;

  const setSeason = (season: number) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("season", String(season));
        return next;
      },
      { replace: true },
    );

  return (
    <div className={`flex flex-col gap-5 transition-opacity ${query.isPlaceholderData ? "opacity-60" : ""}`}>
      <div className="flex flex-col gap-3">
        <h1 className="disp text-[3.5rem] leading-[0.86] sm:text-[4.5rem]">
          {s ? `${s.season} ` : ""}
          <span className="text-[var(--tb)]">standings</span>
        </h1>
        {s && s.seasons.length > 1 && (
          <ChipRow
            options={s.seasons.map((x) => ({ key: String(x), label: String(x) }))}
            value={String(s.season)}
            onChange={(x) => setSeason(Number(x))}
            label="Season"
          />
        )}
      </div>

      <QueryState isPending={query.isPending} error={query.error} empty={!s?.teams.length} emptyText="No games on record for that season." rows={4}>
        {s && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted">
                Regular season. Sorted by win percentage, then point difference, not the NFL's official tiebreakers. Tap a team to open its page.
              </p>
              {s.divisions_apply ? (
                <Segmented options={VIEWS} value={view} onChange={setView} label="Standings view" />
              ) : (
                <p className="text-sm text-muted">Divisions shown from 2002, when the current ones began.</p>
              )}
            </div>
            {view === "divisions" && <Divisions rows={s.teams} season={s.season} />}
            {view === "conferences" && (
              <div className="grid gap-5 lg:grid-cols-2">
                {CONFERENCES.map((c, i) => (
                  <Panel key={c} title={c} delay={0.06 * i}>
                    <StandingsTable rows={s.teams.filter((r) => r.info.conference === c)} season={s.season} />
                  </Panel>
                ))}
              </div>
            )}
            {view === "league" && <League rows={s.teams} season={s.season} />}
          </>
        )}
      </QueryState>
    </div>
  );
}

function Divisions({ rows, season }: { rows: StandingRow[]; season: number }) {
  const groups = useMemo(() => {
    const out: Array<[string, StandingRow[]]> = [];
    for (const conf of CONFERENCES) {
      for (const d of DIVISION_ORDER) {
        const name = `${conf} ${d}`;
        const members = rows.filter((r) => r.info.division === name);
        if (members.length) out.push([name, members]);
      }
    }
    return out;
  }, [rows]);
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {groups.map(([name, members], gi) => (
        <section
          key={name}
          aria-label={name}
          className="panel rise flex flex-col gap-1 p-3"
          style={{ animationDelay: `${0.04 * gi}s` }}
        >
          <h2 className="disp px-2 pb-1 pt-1 text-[1.5rem]">{name}</h2>
          <ol className="flex flex-col gap-1">
            {members.map((row, i) => (
              <li key={row.info.team}>
                <DivisionRow row={row} place={i + 1} season={season} />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function DivisionRow({ row, place, season }: { row: StandingRow; place: number; season: number }) {
  const r = row.record;
  const t = team(row.info.team);
  const diff = r.points_for - r.points_against;
  return (
    <TeamLink
      abbr={row.info.team}
      season={season}
      className="group relative flex min-h-12 items-center gap-2.5 overflow-hidden rounded-[12px] px-2.5 py-2 transition-colors hover:bg-white/[0.05]"
    >
      {place === 1 && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ background: `linear-gradient(90deg, ${t ? `${t.bright}38` : "transparent"}, transparent 70%)` }}
        />
      )}
      <span className="num relative w-4 text-[1.1rem] text-faint">{place}</span>
      <TeamMark abbr={row.info.team} size={15} />
      <span className="num relative min-w-0 flex-1 truncate text-[1.3rem] leading-none text-white">{t?.short ?? row.info.name}</span>
      <span className="relative flex flex-col items-end">
        <span className="num text-[1.3rem] leading-none text-white">{wlt(r.wins, r.losses, r.ties)}</span>
        <span className={`text-[0.6875rem] font-bold ${diff > 0 ? "text-[var(--tb)]" : "text-muted"}`}>{diff === 0 ? "0" : signed(diff, 0)}</span>
      </span>
    </TeamLink>
  );
}

/** Every team in one list, with point difference as bars on one scale: team colour right, white stripes left. */
function League({ rows, season }: { rows: StandingRow[]; season: number }) {
  const diffs = rows.map((r) => r.record.points_for - r.record.points_against);
  const max = Math.max(1, ...diffs.map(Math.abs));
  return (
    <Panel title="League" subtitle="Bars show point difference">
      <ol className="flex flex-col gap-1">
        {rows.map((row, i) => {
          const r = row.record;
          const diff = diffs[i] ?? 0;
          const share = Math.abs(diff) / max;
          const t = team(row.info.team);
          return (
            <li key={row.info.team}>
              <TeamLink
                abbr={row.info.team}
                season={season}
                className="grid min-h-11 grid-cols-[1.5rem_minmax(0,9rem)_3.5rem_minmax(0,1fr)] items-center gap-2.5 rounded-[10px] px-2 py-1.5 hover:bg-white/[0.04] sm:grid-cols-[1.5rem_12rem_4rem_minmax(0,1fr)]"
              >
                <span className="num text-right text-[1.05rem] text-faint">{i + 1}</span>
                <span className="flex min-w-0 items-center gap-2">
                  <TeamMark abbr={row.info.team} size={13} />
                  <span className="truncate font-bold">{t?.short ?? row.info.name}</span>
                </span>
                <span className="num text-right text-[1.2rem] leading-none">{wlt(r.wins, r.losses, r.ties)}</span>
                <span className="grid grid-cols-2 items-center" aria-label={`Point difference ${diff}`}>
                  <span className="flex items-center justify-end gap-1.5">
                    {diff < 0 && <span className="text-xs font-bold text-muted">{signed(diff, 0)}</span>}
                    {diff < 0 && (
                      <span className="neg-stripes grow-right h-3 rounded-l-full [transform-origin:right]" style={{ width: `${share * 85}%`, animationDelay: `${0.02 * i}s` }} />
                    )}
                  </span>
                  <span className="flex items-center gap-1.5 border-l border-white/20">
                    {diff > 0 && (
                      <span
                        className="grow-right h-3 rounded-r-full"
                        style={{
                          width: `${share * 85}%`,
                          background: `linear-gradient(90deg, ${t?.primary ?? "#555"}, ${t?.bright ?? "#999"})`,
                          animationDelay: `${0.02 * i}s`,
                        }}
                      />
                    )}
                    {diff >= 0 && <span className={`text-xs font-bold ${diff > 0 ? "text-white" : "text-muted"}`}>{diff === 0 ? "0" : signed(diff, 0)}</span>}
                  </span>
                </span>
              </TeamLink>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
