import type { ReactNode } from "react";

import { useOpenPlays, type PlaysTarget } from "../lib/plays";

/**
 * A number you can tap to see the plays behind it. Looks like the number it
 * wraps, with a dotted underline so people learn that numbers open plays.
 */
export function StatTap({
  target,
  children,
  label,
  className = "",
  variant = "inline",
}: {
  target: PlaysTarget | null;
  children: ReactNode;
  /** Accessible name, e.g. "Penix passing yards, week 5: see the plays". */
  label: string;
  className?: string;
  /** inline: a number in text or a table; block: a whole tile or ring. */
  variant?: "inline" | "block";
}) {
  const open = useOpenPlays();
  if (!target) return <>{children}</>;
  return (
    <button type="button" className={`${variant === "block" ? "tap-block" : "stat-tap"} ${className}`} aria-label={label} onClick={() => open(target)}>
      {children}
    </button>
  );
}
