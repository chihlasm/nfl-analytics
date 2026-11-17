import { useSearchParams } from "react-router";

import { PlayerSearch } from "../components/PlayerSearch";
import { Panel } from "../components/ui";
import { useScreenTeam } from "../lib/palette";

export function Players() {
  useScreenTeam(null);
  const [params] = useSearchParams();
  const initial = params.get("q") ?? "";
  return (
    <div className="flex flex-col gap-5">
      <div className="rise flex flex-col gap-1 pt-2">
        <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-[var(--tb)]">Every player since 1999</span>
        <h1 className="disp text-[4rem] leading-[0.84] text-white sm:text-[5.5rem]">Players</h1>
      </div>
      <Panel title="Find a player">
        <PlayerSearch key={initial} initial={initial} autoFocus />
      </Panel>
    </div>
  );
}
