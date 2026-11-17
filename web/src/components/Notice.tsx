import { AlertTriangle, Info } from "lucide-react";
import type { ReactNode } from "react";

/** An inline message. `alert` is announced to screen readers when it appears. */
export function Notice({ tone = "info", children }: { tone?: "info" | "alert"; children: ReactNode }) {
  const Icon = tone === "alert" ? AlertTriangle : Info;
  return (
    <div
      role={tone === "alert" ? "alert" : "status"}
      className="flex gap-3 rounded-[14px] border border-[var(--color-line)] bg-white/[0.04] px-4 py-3 text-sm"
    >
      <Icon size={18} className={`mt-0.5 shrink-0 ${tone === "alert" ? "text-[var(--tb)]" : "text-muted"}`} aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. Try again.";
}

/** Placeholder blocks while something loads: same size as the real thing, so nothing jumps. */
export function Skeleton({ rows = 4, className = "h-12" }: { rows?: number; className?: string }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`animate-pulse rounded-[14px] bg-white/[0.05] ${className}`} />
      ))}
    </div>
  );
}

/** Loading, error and empty states for a query, handled the same way everywhere. */
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
