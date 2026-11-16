import { team } from "../lib/teams";

/**
 * A team's identity mark: a small two-tone disc in the team's colours with a hairline
 * ring, so dark team colours stay visible on the dark theme. Decorative: the team's
 * abbreviation or name is always written next to it.
 */
export function TeamMark({ abbr, size = 12 }: { abbr: string | null | undefined; size?: number }) {
  const t = team(abbr);
  const primary = t?.primary ?? "var(--color-faint)";
  const secondary = t?.secondary ?? "var(--color-faint)";
  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0 rounded-full ring-1 ring-[var(--color-line)]"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${primary} 0 55%, ${secondary} 55% 100%)`,
      }}
    />
  );
}

/** Mark + abbreviation, with the full team name for screen readers and on hover. */
export function TeamTag({ abbr, className = "" }: { abbr: string | null | undefined; className?: string }) {
  if (!abbr) return null;
  const t = team(abbr);
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`} title={t?.name}>
      <TeamMark abbr={abbr} />
      <span aria-hidden={t ? "true" : undefined}>{abbr}</span>
      {t && <span className="sr-only">{t.name}</span>}
    </span>
  );
}
