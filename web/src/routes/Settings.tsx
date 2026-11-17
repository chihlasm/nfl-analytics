import { Check } from "lucide-react";
import type { ReactNode } from "react";

import { TeamMark } from "../components/TeamMark";
import { Panel } from "../components/ui";
import { LEAGUE_LOOKS, alpha, useScreenTeam } from "../lib/palette";
import { setHomeLook, useHomeLook, type HomeLook } from "../lib/settings";
import { TEAMS } from "../lib/teams";

const DIVISIONS: Array<[string, string[]]> = [
  ["AFC East", ["BUF", "MIA", "NE", "NYJ"]],
  ["AFC North", ["BAL", "CIN", "CLE", "PIT"]],
  ["AFC South", ["HOU", "IND", "JAX", "TEN"]],
  ["AFC West", ["DEN", "KC", "LAC", "LV"]],
  ["NFC East", ["DAL", "NYG", "PHI", "WAS"]],
  ["NFC North", ["CHI", "DET", "GB", "MIN"]],
  ["NFC South", ["ATL", "CAR", "NO", "TB"]],
  ["NFC West", ["ARI", "LA", "SEA", "SF"]],
];

/**
 * One choice in the Home look picker: a real radio input (keyboard and screen readers
 * work as normal) styled as a card that previews the colours.
 */
function LookOption({
  value,
  checked,
  colors,
  children,
}: {
  value: HomeLook;
  checked: boolean;
  colors: [string, string, string];
  children: ReactNode;
}) {
  const [p, b, s] = colors;
  return (
    <label
      className="relative flex cursor-pointer items-center gap-3 overflow-hidden rounded-[16px] p-3.5 transition-transform duration-200 hover:-translate-y-0.5 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-white"
      style={{
        background: `linear-gradient(120deg, ${alpha(p, checked ? 0.75 : 0.35)}, rgba(255,255,255,0.03) 70%)`,
        border: `1px solid ${checked ? b : "rgba(255,255,255,0.1)"}`,
        boxShadow: checked ? `0 0 28px -8px ${alpha(b, 0.9)}` : undefined,
      }}
    >
      <input
        type="radio"
        name="home-look"
        value={value}
        checked={checked}
        onChange={() => setHomeLook(value)}
        className="sr-only"
      />
      <span aria-hidden="true" className="flex shrink-0 overflow-hidden rounded-full ring-1 ring-white/30">
        <span className="h-7 w-4" style={{ background: p }} />
        <span className="h-7 w-4" style={{ background: b }} />
        <span className="h-7 w-4" style={{ background: s }} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">{children}</span>
      {checked && <Check size={20} className="shrink-0 text-white" aria-hidden="true" />}
    </label>
  );
}

export function Settings() {
  useScreenTeam(null);
  const look = useHomeLook();
  const isTeam = look !== "nfl" && look !== "ember";

  return (
    <div className="flex flex-col gap-5">
      <div className="rise flex flex-col gap-1 pt-2">
        <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-[var(--tb)]">Saved on this device</span>
        <h1 className="disp text-[4rem] leading-[0.84] text-white sm:text-[5.5rem]">Settings</h1>
      </div>

      <Panel
        title="Home look"
        subtitle="The colours of Home, Players and this page. Player pages always wear the player's team colours."
      >
        <fieldset className="flex flex-col gap-5">
          <legend className="sr-only">Home look</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <LookOption value="nfl" checked={look === "nfl"} colors={[LEAGUE_LOOKS.nfl.primary, LEAGUE_LOOKS.nfl.bright, "#FFFFFF"]}>
              <span className="num text-[1.5rem] leading-none text-white">NFL</span>
              <span className="text-sm text-gray-300">League navy, red and white</span>
            </LookOption>
            <LookOption value="ember" checked={look === "ember"} colors={[LEAGUE_LOOKS.ember.primary, "#FF8A4C", "#FFFFFF"]}>
              <span className="num text-[1.5rem] leading-none text-white">Ember</span>
              <span className="text-sm text-gray-300">Hot orange on black</span>
            </LookOption>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="num text-[1.4rem] uppercase text-white">Your team</h3>
              {isTeam && <span className="text-sm text-gray-300">Using the {TEAMS[look]?.name} colours</span>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {DIVISIONS.map(([division, abbrs]) => (
                <div key={division} className="flex flex-col gap-1.5">
                  <span className="text-[0.6875rem] font-extrabold uppercase tracking-[0.1em] text-muted">{division}</span>
                  {abbrs.map((abbr) => {
                    const t = TEAMS[abbr];
                    if (!t) return null;
                    const checked = look === abbr;
                    return (
                      <label
                        key={abbr}
                        className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[12px] px-3 text-sm font-semibold transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-white"
                        style={{
                          background: checked ? `linear-gradient(100deg, ${alpha(t.primary, 0.85)}, ${alpha(t.bright, 0.35)})` : "rgba(255,255,255,0.03)",
                          border: `1px solid ${checked ? t.bright : "rgba(255,255,255,0.07)"}`,
                          color: checked ? "#fff" : "#d1d5db",
                        }}
                      >
                        <input
                          type="radio"
                          name="home-look"
                          value={abbr}
                          checked={checked}
                          onChange={() => setHomeLook(abbr)}
                          className="sr-only"
                        />
                        <TeamMark abbr={abbr} size={14} />
                        <span className="flex-1">{t.name}</span>
                        {checked && <Check size={16} aria-hidden="true" />}
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </fieldset>
      </Panel>
    </div>
  );
}
