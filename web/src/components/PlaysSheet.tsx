import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

import type { PlayList, PlayRow, PlayWeek, StatInfo } from "../lib/api";
import { weekLabel } from "../lib/format";
import { useCountUp } from "../lib/motion";
import { themeVars } from "../lib/palette";
import { readPlays, useClosePlays, useUpdatePlays } from "../lib/plays";
import { usePlays } from "../lib/queries";
import { statValue } from "../lib/stats";
import { team } from "../lib/teams";
import { Notice, errorText } from "./Notice";
import { TeamLink, TeamMark } from "./TeamMark";
import { ChipRow, Segmented, type Option } from "./ui";

type View = "plays" | "weeks";
const VIEWS: readonly Option<View>[] = [
  { key: "plays", label: "Plays" },
  { key: "weeks", label: "By week" },
];
const SORTS: readonly Option<"time" | "value">[] = [
  { key: "time", label: "In order" },
  { key: "value", label: "Biggest first" },
];

const SEASON_TEXT: Record<string, string> = {
  REG: "regular season",
  POST: "playoffs",
  ALL: "regular season and playoffs",
};

/**
 * The plays behind any number. Mounted once in the app shell and driven by the
 * address bar (lib/plays.ts), so every screen can open it and Back closes it.
 */
export function PlaysSheet() {
  const [params] = useSearchParams();
  const q = readPlays(params);
  const close = useClosePlays();
  const ref = useRef<HTMLDialogElement>(null);
  const open = q !== null;
  const latest = useRef(open);
  latest.current = open;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      document.documentElement.classList.add("sheet-open");
    } else if (!open && dialog.open) {
      dialog.close();
    }
    if (!open) document.documentElement.classList.remove("sheet-open");
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="plays-sheet"
      aria-labelledby="plays-title"
      onClose={() => {
        document.documentElement.classList.remove("sheet-open");
        if (latest.current) close(); // Escape key: keep the address bar in step.
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close(); // a tap on the dimmed backdrop
      }}
    >
      {q && <Panel key={`${q.player ?? q.team}-${q.stat}`} onClose={close} />}
    </dialog>
  );
}

function Panel({ onClose }: { onClose: () => void }) {
  const [params] = useSearchParams();
  const q = readPlays(params);
  const update = useUpdatePlays();
  const query = usePlays(q);
  const [view, setView] = useState<View>("plays");
  const pages = query.data?.pages ?? [];
  const first = pages[0];
  const rows = pages.flatMap((p) => p.rows);
  const teamAbbr = first?.team ?? first?.player?.team ?? q?.team;
  const palette = team(teamAbbr);

  return (
    <div className="plays-panel" style={palette ? themeVars(palette) : undefined}>
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-64" style={{ background: "radial-gradient(120% 100% at 0% 0%, color-mix(in srgb, var(--tp) 55%, transparent), transparent 70%)" }} />
      <div className="relative flex flex-col gap-4 p-4 pb-10 sm:p-6">
        <div className="mx-auto h-1.5 w-12 rounded-full bg-white/20 md:hidden" aria-hidden="true" />
        <div className="flex items-start justify-between gap-3">
          {first ? <Header list={first} /> : <div className="h-24 flex-1 animate-pulse rounded-2xl bg-white/[0.05]" aria-hidden="true" />}
          <button type="button" onClick={onClose} className="pill !min-h-11 !w-11 shrink-0 !px-0" aria-label="Close plays">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {query.error && <Notice tone="alert">{errorText(query.error)}</Notice>}

        {first && (
          <>
            <div className="flex flex-col gap-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Segmented options={VIEWS} value={view} onChange={setView} label="Plays view" />
                {view === "plays" && <Segmented options={SORTS} value={first.sort} onChange={(s) => update({ sort: s === "value" ? "value" : undefined })} label="Order" />}
              </div>
              {first.weeks.length > 1 && (
                <ChipRow
                  options={[
                    { key: "", label: "All weeks" },
                    ...first.weeks.map((w) => ({ key: `${w.season_type}:${w.week}`, label: weekLabel(w.week, w.season_type, first.season) })),
                  ]}
                  value={first.week ? `${first.weeks.find((w) => w.week === first.week)?.season_type ?? "REG"}:${first.week}` : ""}
                  onChange={(k) => update({ week: k ? Number(k.split(":")[1]) : undefined })}
                  label="Week"
                />
              )}
              {first.stat.unit === "rate" && view === "plays" && (
                <ChipRow
                  options={[
                    { key: "all", label: "All plays" },
                    { key: "counted", label: "Counted only" },
                  ]}
                  value={first.counted_only ? "counted" : "all"}
                  onChange={(k) => update({ counted_only: k === "counted" ? "true" : undefined })}
                  label="Which plays"
                />
              )}
            </div>

            <div className={`transition-opacity ${query.isPlaceholderData ? "opacity-50" : ""}`}>
              {view === "plays" ? (
                rows.length === 0 ? (
                  <Notice>No plays in this selection.</Notice>
                ) : (
                  <ol className="flex flex-col gap-2.5">
                    {rows.map((r) => (
                      <li key={`${r.game_id}-${r.play_id}`}>
                        <PlayCard row={r} stat={first.stat} season={first.season} />
                      </li>
                    ))}
                  </ol>
                )
              ) : (
                <WeekBars
                  weeks={first.weeks}
                  stat={first.stat}
                  season={first.season}
                  onPick={(w) => {
                    update({ week: w });
                    setView("plays");
                  }}
                />
              )}
            </div>

            {view === "plays" && query.hasNextPage && (
              <button type="button" className="pill mx-auto min-h-12 px-6" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                {query.isFetchingNextPage ? "Loading…" : `Show more (${rows.length} of ${first.plays})`}
              </button>
            )}

            <Footnotes list={first} />
          </>
        )}
      </div>
    </div>
  );
}

function Header({ list }: { list: PlayList }) {
  const title = useRef<HTMLHeadingElement>(null);
  // Focus the title once the plays arrive, so screen readers announce the stat
  // first and the close button doesn't sit there with a focus ring.
  useEffect(() => title.current?.focus({ preventScroll: true }), []);
  const t = useCountUp(`${list.player?.player_id ?? list.subject_team}-${list.stat.key}-${list.week}-${list.team}`);
  const scope = [
    list.week ? weekLabel(list.week, list.weeks.find((w) => w.week === list.week)?.season_type, list.season) : `${list.season} ${SEASON_TEXT[list.season_type] ?? ""}`,
    list.team && list.player ? `with ${team(list.team)?.short ?? list.team}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const isRate = list.stat.unit === "rate";
  const shown = list.value == null ? null : list.stat.unit === "count" || list.stat.unit === "yards" ? list.value * t : list.value;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      {list.player ? (
        <Link to={`/players/${list.player.player_id}?season=${list.season}`} className="flex min-w-0 items-center gap-2 text-sm font-bold text-gray-200 hover:underline hover:underline-offset-4">
          <TeamMark abbr={list.team ?? list.player.team} size={13} />
          <span className="truncate">{list.player.name}</span>
          {list.player.position && <span className="text-xs font-semibold text-muted">{list.player.position}</span>}
        </Link>
      ) : (
        <TeamLink abbr={list.subject_team} season={list.season} className="flex min-w-0 items-center gap-2 text-sm font-bold text-gray-200">
          <TeamMark abbr={list.subject_team} size={15} />
          <span className="truncate">{team(list.subject_team)?.name ?? list.subject_team}</span>
          <span className="text-xs font-semibold text-muted">{list.stat.group === "defense" ? "Defense" : "Offense"}</span>
        </TeamLink>
      )}
      <h2 ref={title} id="plays-title" tabIndex={-1} className="disp text-[2rem] leading-[0.95] outline-none sm:text-[2.4rem]">
        {list.stat.label}
      </h2>
      <p className="text-sm text-muted">{scope}</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="num text-[3.4rem] leading-none text-white" style={{ textShadow: "0 0 30px color-mix(in srgb, var(--tb) 60%, transparent)" }}>
          {statValue(list.stat, shown == null ? null : list.stat.decimals ? shown : Math.round(shown))}
        </span>
        <span className="text-sm font-semibold text-gray-300">
          {isRate ? `${list.counted} of ${list.plays} plays` : `${list.plays} ${list.plays === 1 ? "play" : "plays"}`}
        </span>
      </div>
    </div>
  );
}

/** What a counted play is called, for rates where "Counted" says less than it could. */
const COUNTED_LABEL: Record<string, string> = {
  success_rate: "Success",
  explosive_rate: "Explosive",
  third_down_rate: "Converted",
  short_throw_miss_rate: "Miss",
  catchable_ball_rate: "Catchable",
};

function valueChip(stat: StatInfo, r: PlayRow): string | null {
  if (stat.unit === "rate") return null;
  if (r.value == null) return null;
  if (stat.unit === "epa") return `${statValue(stat, r.value)} EPA`;
  if (stat.key.includes("yards") || stat.unit === "yards") return `${r.value > 0 ? "+" : ""}${Math.round(r.value)} yds`;
  if (stat.key === "def_sacks" && r.value === 0.5) return "Half sack";
  return null;
}

function PlayCard({ row: r, stat, season }: { row: PlayRow; stat: StatInfo; season: number }) {
  const chip = valueChip(stat, r);
  const situation = [
    r.qtr ? (r.qtr > 4 ? "OT" : `Q${r.qtr}`) : null,
    r.clock,
    r.down ? `${["", "1st", "2nd", "3rd", "4th"][r.down] ?? `${r.down}th`} & ${r.distance ?? "?"}` : null,
    r.field ? `at ${r.field}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const highlight = stat.unit === "rate" ? r.counted : true;
  return (
    <article
      className="relative flex flex-col gap-2 overflow-hidden rounded-[16px] p-3.5"
      style={{
        background: highlight ? "linear-gradient(110deg, color-mix(in srgb, var(--tp) 22%, #0d0d10), #0d0d10 60%)" : "#0d0d10",
        border: `1px solid ${stat.unit === "rate" && r.counted ? "color-mix(in srgb, var(--tb) 60%, transparent)" : "rgba(255,255,255,0.08)"}`,
      }}
    >
      <div className="flex items-center justify-between gap-3 text-xs font-bold">
        <span className="flex min-w-0 items-center gap-1.5 text-gray-200">
          <span className="text-[var(--tb)]">{weekLabel(r.week, r.season_type, season)}</span>
          {r.opponent && (
            <TeamLink abbr={r.opponent} season={season} className="inline-flex items-center gap-1.5">
              <span className="text-muted">{r.is_home === false ? "at" : "vs"}</span>
              <TeamMark abbr={r.opponent} size={11} />
              {r.opponent}
            </TeamLink>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {stat.unit === "rate" && r.counted && (
            <span className="rounded-full px-2 py-0.5 text-[0.6875rem] font-extrabold uppercase tracking-[0.06em] text-white" style={{ background: "var(--tb)" }}>
              {COUNTED_LABEL[stat.key.replace(/_allowed$/, "")] ?? "Counted"}
            </span>
          )}
          {r.tags.map((t) => (
            <span key={t} className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-extrabold uppercase tracking-[0.06em] ${t === "TD" ? "bg-white text-black" : "bg-white/[0.1] text-gray-200"}`}>
              {t}
            </span>
          ))}
          {chip && <span className="num text-[1.15rem] leading-none text-white">{chip}</span>}
        </span>
      </div>
      {situation && <p className="text-xs font-semibold text-muted">{situation}</p>}
      {r.description && <p className="text-sm leading-relaxed text-gray-200">{r.description}</p>}
      {(r.epa != null || r.air_yards != null) && (
        <p className="flex flex-wrap gap-x-4 text-xs text-faint">
          {r.air_yards != null && <span>{Math.round(r.air_yards)} air yards</span>}
          {r.epa != null && stat.unit !== "epa" && <span>{statValue({ unit: "epa", decimals: 2 }, r.epa)} EPA</span>}
        </p>
      )}
    </article>
  );
}

/** One bar per week: the stat that week. Tap a bar to see that week's plays. */
function WeekBars({ weeks, stat, season, onPick }: { weeks: PlayWeek[]; stat: StatInfo; season: number; onPick: (week: number) => void }) {
  const max = Math.max(1e-9, ...weeks.map((w) => Math.abs(w.value ?? 0)));
  return (
    <ol className="flex flex-col gap-2">
      {weeks.map((w, i) => {
        const v = w.value ?? 0;
        return (
          <li key={`${w.season_type}-${w.week}`}>
            <button type="button" onClick={() => onPick(w.week)} className="group grid w-full grid-cols-[4.5rem_minmax(0,1fr)_4.5rem] items-center gap-3 rounded-[12px] px-2 py-2 text-left hover:bg-white/[0.05]">
              <span className="text-xs font-bold text-gray-300">{weekLabel(w.week, w.season_type, season)}</span>
              <span className="h-3.5 overflow-hidden rounded-md bg-white/[0.06]" aria-hidden="true">
                <span
                  className={`grow-right block h-full rounded-md ${v < 0 ? "neg-stripes" : ""}`}
                  style={{
                    width: `${Math.max(3, (Math.abs(v) / max) * 100)}%`,
                    animationDelay: `${i * 0.03}s`,
                    ...(v < 0 ? {} : { background: "linear-gradient(90deg, var(--tp), var(--tb))", boxShadow: "0 0 12px -3px var(--tb)" }),
                  }}
                />
              </span>
              <span className="text-right">
                <span className="num block text-[1.2rem] leading-none text-white">{statValue(stat, w.value)}</span>
                <span className="text-[0.6875rem] text-muted">
                  {w.plays} {w.plays === 1 ? "play" : "plays"}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Footnotes({ list }: { list: PlayList }) {
  const differs = list.official != null && list.value != null && Math.abs(list.official - list.value) > 0.01;
  return (
    <div className="flex flex-col gap-1.5 border-t border-white/[0.08] pt-3 text-xs text-faint">
      {list.stat.description && <p>{list.stat.description}</p>}
      {differs && (
        <p>
          The official box score says {statValue(list.stat, list.official)}; these plays add up to {statValue(list.stat, list.value)}. Older play-by-play records sometimes disagree with the
          official totals by a few plays.
        </p>
      )}
      <p>Play-by-play from nflverse.{list.stat.credit ? ` Charting: ${list.stat.credit} (CC-BY-SA 4.0).` : ""}</p>
    </div>
  );
}
