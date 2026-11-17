import { teamDisc } from "../lib/palette";
import { team } from "../lib/teams";

/** A team's two-tone disc. Decorative: the team's name is always written beside it. */
export function TeamMark({ abbr, size = 12 }: { abbr: string | null | undefined; size?: number }) {
  return <span aria-hidden="true" className="inline-block" style={teamDisc(abbr, size)} />;
}

/** Disc + abbreviation, with the full team name for screen readers and on hover. */
export function TeamTag({ abbr, className = "" }: { abbr: string | null | undefined; className?: string }) {
  if (!abbr) return null;
  const t = team(abbr);
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`} title={t?.name}>
      <TeamMark abbr={abbr} size={10} />
      <span aria-hidden={t ? "true" : undefined}>{abbr}</span>
      {t && <span className="sr-only">{t.name}</span>}
    </span>
  );
}
