import { useId, type ReactNode } from "react";

/**
 * The top of every screen: the title, an optional line under it, and an optional control
 * on the right (a sync time, a view switch). Keeps titles the same size and spacing
 * everywhere.
 */
export function PageHeader({
  title,
  children,
  action,
}: {
  title: string;
  /** A short line under the title. */
  children?: ReactNode;
  /** Sits beside the title on wide screens and under it on phones. */
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-[2rem] font-semibold leading-tight">{title}</h1>
        {children && <div className="max-w-prose text-muted">{children}</div>}
      </div>
      {action}
    </header>
  );
}

/**
 * A titled card: the basic block of every screen below the header. `action` is a quiet
 * link or button at the top right, `aside` a figure next to it (a total, a count).
 */
export function Section({
  title,
  action,
  aside,
  description,
  children,
  className = "",
}: {
  title: ReactNode;
  action?: ReactNode;
  aside?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={`card flex flex-col gap-4 p-5 sm:p-6 ${className}`}>
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id={id} className="text-xl font-semibold">
            {title}
          </h2>
          {(aside || action) && (
            <span className="flex shrink-0 items-baseline gap-3 text-sm [&_a]:font-medium [&_a]:text-muted [&_a]:underline-offset-4 hover:[&_a]:text-ink hover:[&_a]:underline">
              {aside}
              {action}
            </span>
          )}
        </div>
        {description && <div className="max-w-prose text-sm text-muted">{description}</div>}
      </div>
      {children}
    </section>
  );
}

/** A single-line summary figure inside a card: a label above a large number. */
export function Figure({
  label,
  value,
  note,
  tone,
  size = "md",
}: {
  label: ReactNode;
  value: string;
  note?: ReactNode;
  tone?: "alert";
  size?: "md" | "lg";
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      <span
        className={`figures font-display font-bold leading-none tracking-tight ${
          size === "lg" ? "text-[2.25rem]" : "text-[1.75rem]"
        } ${tone === "alert" ? "text-alert" : ""}`}
      >
        {value}
      </span>
      {note && <span className="text-sm opacity-80">{note}</span>}
    </div>
  );
}
