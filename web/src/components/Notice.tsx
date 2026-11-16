import { AlertTriangle, Info } from "lucide-react";
import type { ReactNode } from "react";

const styles = {
  info: { icon: Info, color: "var(--color-muted)" },
  alert: { icon: AlertTriangle, color: "var(--color-alert)" },
} as const;

/** An inline message. `alert` is announced to screen readers when it appears. */
export function Notice({ tone = "info", children }: { tone?: keyof typeof styles; children: ReactNode }) {
  const { icon: Icon, color } = styles[tone];
  return (
    <div role={tone === "alert" ? "alert" : "status"} className="flex gap-3 rounded-[var(--radius-control)] bg-sunken px-4 py-3 text-sm">
      <Icon size={18} className="mt-0.5 shrink-0" style={{ color }} aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. Try again.";
}

/** Placeholder rows while a card loads: same height as real content, so nothing jumps. */
export function Skeleton({ rows = 4, className = "h-11" }: { rows?: number; className?: string }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`tile animate-pulse ${className}`} />
      ))}
    </div>
  );
}

/** Loading, error and empty states for a query, so every card handles them the same way. */
export function QueryState({
  isPending,
  error,
  empty,
  emptyText,
  rows,
  children,
}: {
  isPending: boolean;
  error: unknown;
  empty?: boolean;
  emptyText?: ReactNode;
  rows?: number;
  children: ReactNode;
}) {
  if (isPending) return <Skeleton rows={rows} />;
  if (error) return <Notice tone="alert">{errorText(error)}</Notice>;
  if (empty) return <Notice>{emptyText ?? "Nothing to show yet."}</Notice>;
  return <>{children}</>;
}
