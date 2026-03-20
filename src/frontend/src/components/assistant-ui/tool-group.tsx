import type { PropsWithChildren } from "react";

export function ToolGroup({ children, count }: PropsWithChildren<{ count: number }>) {
  return (
    <details className="rounded-xl border border-[var(--da-border)] bg-[var(--da-elevated)]">
      <summary className="cursor-pointer px-4 py-2 text-xs uppercase tracking-[0.2em] text-[var(--da-muted)]">
        {count} tool call{count === 1 ? "" : "s"}
      </summary>
      <div className="space-y-3 px-4 pb-4">{children}</div>
    </details>
  );
}
