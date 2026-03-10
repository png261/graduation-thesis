import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import { useMemo } from "react";

const MAX_PREVIEW_CHARS = 2400;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const formatValue = (value: unknown) => {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const truncate = (value: string) =>
  value.length > MAX_PREVIEW_CHARS
    ? `${value.slice(0, MAX_PREVIEW_CHARS)}\n...`
    : value;

const decodeBase64 = (value?: string) => {
  if (!value) return "";
  try {
    return atob(value);
  } catch {
    return value;
  }
};

export function ToolCallCard(props: ToolCallMessagePartProps) {
  const status = props.isError
    ? "error"
    : props.status?.type ?? (props.result ? "complete" : "running");
  const artifact = isRecord(props.artifact) ? props.artifact : null;
  const artifactPreview = useMemo(() => {
    if (!artifact) return null;
    const data = artifact.dataBase64 as string | undefined;
    if (!data) return null;
    const decoded = decodeBase64(data);
    return truncate(decoded);
  }, [artifact]);

  const argsText = props.argsText || formatValue(props.args);
  const resultText = props.result ? formatValue(props.result) : "";

  return (
    <details className="rounded-xl border border-[var(--da-border)] bg-[var(--da-elevated)] shadow-sm">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-[var(--da-text)]">
        <span className="flex items-center gap-2">
          <span className="inline-flex h-2 w-2 rounded-full bg-[var(--da-accent)]" />
          Tool: {props.toolName ?? "tool"}
        </span>
        <span className="text-xs uppercase tracking-[0.2em] text-[var(--da-muted)]">
          {status}
        </span>
      </summary>
      <div className="space-y-4 border-t border-[var(--da-border)] px-4 py-4 text-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--da-muted)]">
            Args
          </p>
          <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-[var(--da-bg)] p-3 text-xs text-blue-100/85">
            {truncate(argsText)}
          </pre>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--da-muted)]">
            Result
          </p>
          <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-[var(--da-bg)] p-3 text-xs text-blue-100/85">
            {resultText ? truncate(resultText) : "Waiting for tool output..."}
          </pre>
        </div>
        {artifactPreview && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--da-muted)]">
              Artifact Preview
            </p>
            <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-[var(--da-bg)] p-3 text-xs text-blue-100/85">
              {artifactPreview}
            </pre>
          </div>
        )}
      </div>
    </details>
  );
}
