import { Search } from "lucide-react";
import { useDeferredValue, useId, useState } from "react";
import { Link } from "react-router";

import { alpha } from "../lib/palette";
import { usePlayerSearch } from "../lib/queries";
import { team } from "../lib/teams";
import { TeamMark } from "./TeamMark";

/**
 * Search box with live results. Results are a plain list of links (not a custom
 * combobox), so keyboard and screen-reader behaviour is the browser's own. Each
 * result glows faintly in the player's team colour.
 */
export function PlayerSearch({ autoFocus = false, initial = "" }: { autoFocus?: boolean; initial?: string }) {
  const [q, setQ] = useState(initial);
  const deferred = useDeferredValue(q);
  const { data, isFetching, error } = usePlayerSearch(deferred);
  const id = useId();
  const term = q.trim();

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor={id} className="sr-only">
        Search players
      </label>
      <div className="flex min-h-12 items-center gap-2.5 rounded-full border border-white/10 bg-black/50 px-4 focus-within:border-[var(--tb)]">
        <Search size={18} className="shrink-0 text-faint" aria-hidden="true" />
        <input
          id={id}
          type="search"
          className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-faint"
          placeholder="Search any player since 1999"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
        />
      </div>
      {term.length >= 2 && (
        <div aria-live="polite" aria-busy={isFetching}>
          {error ? (
            <p className="text-sm text-[var(--tb)]">Search isn't working right now. Try again in a moment.</p>
          ) : data && data.length === 0 && !isFetching ? (
            <p className="text-sm text-muted">No players match “{term}”.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {(data ?? []).map((p) => {
                const t = team(p.team);
                return (
                  <li key={p.player_id}>
                    <Link
                      to={`/players/${p.player_id}`}
                      className="flex min-h-14 items-center gap-3 rounded-[14px] border border-white/[0.06] px-3.5 transition-transform duration-200 hover:-translate-y-0.5"
                      style={{ background: `linear-gradient(90deg, ${t ? alpha(t.bright, 0.16) : "rgba(255,255,255,0.03)"}, rgba(255,255,255,0.02) 55%)` }}
                    >
                      <TeamMark abbr={p.team} size={14} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-bold text-white">{p.display_name}</span>
                        <span className="truncate text-xs font-semibold text-muted">
                          {[p.position, t?.short ?? p.team].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      {p.last_season && <span className="num text-[1.25rem] text-muted">{p.last_season}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
