import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import { useMemo } from "react";

const MAX_PREVIEW_CHARS = 2400;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function formatValue(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function truncate(value: string) {
  return value.length > MAX_PREVIEW_CHARS ? `${value.slice(0, MAX_PREVIEW_CHARS)}\n...` : value;
}

function decodeBase64(value?: string) {
  if (!value) return "";
  try {
    return atob(value);
  } catch {
    return value;
  }
}

function getToolCallStatus(props: ToolCallMessagePartProps) {
  if (props.isError) return "error";
  return props.status?.type ?? (props.result ? "complete" : "running");
}

function useArtifactPreview(artifact: unknown) {
  return useMemo(() => {
    if (!isRecord(artifact)) return null;
    const data = artifact.dataBase64 as string | undefined;
    if (!data) return null;
    return truncate(decodeBase64(data));
  }, [artifact]);
}

function ToolCallSummary({ toolName, status }: { toolName: string; status: string }) {
  return (
    <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-[var(--da-text)]">
      <span className="flex items-center gap-2"><span className="inline-flex h-2 w-2 rounded-full bg-[var(--da-accent)]" />Tool: {toolName}</span>
      <span className="text-xs uppercase tracking-[0.2em] text-[var(--da-muted)]">{status}</span>
    </summary>
  );
}

function ToolCallSection({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--da-muted)]">{label}</p>
      <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-[var(--da-bg)] p-3 text-xs text-blue-100/85">{value}</pre>
    </div>
  );
}

function ToolCallBody({
  argsText,
  resultText,
  artifactPreview,
}: {
  argsText: string;
  resultText: string;
  artifactPreview: string | null;
}) {
  return (
    <div className="space-y-4 border-t border-[var(--da-border)] px-4 py-4 text-sm">
      <ToolCallSection label="Args" value={truncate(argsText)} />
      <ToolCallSection label="Result" value={resultText ? truncate(resultText) : "Waiting for tool output..."} />
      {artifactPreview ? <ToolCallSection label="Artifact Preview" value={artifactPreview} /> : null}
    </div>
  );
}

export function ToolCallCard(props: ToolCallMessagePartProps) {
  const status = getToolCallStatus(props);
  const artifactPreview = useArtifactPreview(props.artifact);
  const argsText = props.argsText || formatValue(props.args);
  const resultText = props.result ? formatValue(props.result) : "";
  return (
    <details className="rounded-xl border border-[var(--da-border)] bg-[var(--da-elevated)] shadow-sm">
      <ToolCallSummary toolName={props.toolName ?? "tool"} status={status} />
      <ToolCallBody argsText={argsText} resultText={resultText} artifactPreview={artifactPreview} />
    </details>
  );
}
