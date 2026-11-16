import { Search } from "lucide-react";
import { useDeferredValue, useId, useState } from "react";
import { Link } from "react-router";

import { usePlayerSearch } from "../lib/queries";
import { TeamTag } from "./TeamMark";

/**
 * Search box with live results. Results are a plain list of links (not a custom
 * combobox), so keyboard and screen-reader behaviour is the browser's own.
 */
export function PlayerSearch({ autoFocus = false }: { autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const deferred = useDeferredValue(q);
  const { data, isFetching, error } = usePlayerSearch(deferred);
  const id = useId();
  const term = q.trim();

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor={id} className="sr-only">
        Search players
      </label>
      <div className="relative">
        <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" aria-hidden="true" />
        <input
          id={id}
          type="search"
          className="input pl-10"
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
            <p className="text-sm text-alert">Search isn't working right now. Try again in a moment.</p>
          ) : data && data.length === 0 && !isFetching ? (
            <p className="text-sm text-muted">No players match “{term}”.</p>
          ) : (
            <ul className="flex flex-col">
              {(data ?? []).map((p) => (
                <li key={p.player_id}>
                  <Link
                    to={`/players/${p.player_id}`}
                    className="flex min-h-12 items-center justify-between gap-3 rounded-[var(--radius-control)] px-3 hover:bg-sunken"
                  >
                    <span className="min-w-0 truncate font-medium">{p.display_name}</span>
                    <span className="flex shrink-0 items-center gap-3 text-sm text-muted">
                      <span>{p.position}</span>
                      {p.team && <TeamTag abbr={p.team} />}
                      {p.last_season && <span className="figures w-10 text-right">{p.last_season}</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
