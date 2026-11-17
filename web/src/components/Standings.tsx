import type { StandingRow } from "../lib/api";
import { pctText, signed, winPct, wlt } from "../lib/format";
import { team } from "../lib/teams";
import { TeamLink, TeamMark } from "./TeamMark";

/** A standings table: W-L, win %, point difference, home/away, streak. Rows link to teams. */
export function StandingsTable({
  rows,
  highlight,
  season,
  ranked = true,
}: {
  rows: StandingRow[];
  highlight?: string;
  season: number;
  ranked?: boolean;
}) {
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Team</th>
            <th scope="col">W-L</th>
            <th scope="col">Pct</th>
            <th scope="col">Diff</th>
            <th scope="col" className="hidden sm:table-cell">
              Home
            </th>
            <th scope="col" className="hidden sm:table-cell">
              Away
            </th>
            <th scope="col">Streak</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const r = row.record;
            const diff = r.points_for - r.points_against;
            const me = row.info.team === highlight;
            return (
              <tr key={row.info.team} style={me ? { background: "color-mix(in srgb, var(--tp) 30%, transparent)" } : undefined}>
                <td style={me ? { background: "color-mix(in srgb, var(--tp) 30%, #0b0b0c)" } : undefined}>
                  <TeamLink abbr={row.info.team} season={season} className="inline-flex items-center gap-2 font-bold">
                    {ranked && <span className="w-5 text-right text-muted">{i + 1}</span>}
                    <TeamMark abbr={row.info.team} size={13} />
                    <span>{team(row.info.team)?.short ?? row.info.name}</span>
                  </TeamLink>
                </td>
                <td className="font-bold">{wlt(r.wins, r.losses, r.ties)}</td>
                <td>{pctText(winPct(r.wins, r.losses, r.ties))}</td>
                <td className={diff > 0 ? "text-[var(--tb)]" : "text-gray-300"}>{diff === 0 ? "0" : signed(diff, 0)}</td>
                <td className="hidden sm:table-cell">{r.home}</td>
                <td className="hidden sm:table-cell">{r.away}</td>
                <td className="text-muted">{r.streak ?? "–"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

