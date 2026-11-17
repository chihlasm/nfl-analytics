import { useState } from "react";
import { teamDisc } from "../lib/palette";
import { team } from "../lib/teams";

/** Logos that failed to load this session, so we don't keep asking for them. */
const missing = new Set<string>();

/** Logos read a little smaller than a solid disc, so they get extra room. */
const LOGO_SCALE = 1.6;

/**
 * A team's logo, served by our own API from the copy the ingest job cached.
 * Falls back to the two-tone disc if the logo isn't there (first run, offline CDN).
 * Decorative: the team's name is always written beside it.
 */
export function TeamMark({ abbr, size = 12 }: { abbr: string | null | undefined; size?: number }) {
  const [failed, setFailed] = useState(() => !abbr || missing.has(abbr));
  if (!abbr || failed) {
    return <span aria-hidden="true" className="inline-block shrink-0" style={teamDisc(abbr, size)} />;
  }
  const px = Math.round(size * LOGO_SCALE);
  return (
    <img
      src={`/api/teams/${encodeURIComponent(abbr)}/logo`}
      alt=""
      aria-hidden="true"
      width={px}
      height={px}
      loading="lazy"
      decoding="async"
      draggable={false}
      className="team-logo inline-block shrink-0 object-contain"
      onError={() => {
        missing.add(abbr);
        setFailed(true);
      }}
    />
  );
}

/** Logo + abbreviation, with the full team name for screen readers and on hover. */
export function TeamTag({ abbr, className = "" }: { abbr: string | null | undefined; className?: string }) {
  if (!abbr) return null;
  const t = team(abbr);
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`} title={t?.name}>
      <TeamMark abbr={abbr} size={11} />
      <span aria-hidden={t ? "true" : undefined}>{abbr}</span>
      {t && <span className="sr-only">{t.name}</span>}
    </span>
  );
}
