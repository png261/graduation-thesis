import type {
  ReasoningGroupProps,
  ReasoningMessagePartProps,
} from "@assistant-ui/react";

export function ReasoningBlock({ text }: ReasoningMessagePartProps) {
  if (!text) return null;
  return (
    <div className="rounded-lg border border-[var(--da-border)] bg-[var(--da-bg)] p-3 text-xs text-[color-mix(in_srgb,var(--da-text)_82%,transparent)]">
      {text}
    </div>
  );
}

export function ReasoningGroup({ children }: ReasoningGroupProps) {
  return (
    <details className="rounded-xl border border-dashed border-[var(--da-border)] bg-[var(--da-elevated)]">
      <summary className="cursor-pointer px-4 py-2 text-xs uppercase tracking-[0.2em] text-[var(--da-muted)]">
        Reasoning
      </summary>
      <div className="space-y-2 px-4 pb-4">{children}</div>
    </details>
  );
}
