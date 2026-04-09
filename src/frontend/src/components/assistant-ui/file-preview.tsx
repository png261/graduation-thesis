import type { FileMessagePartProps } from "@assistant-ui/react";
import { useMemo } from "react";

const MAX_PREVIEW_CHARS = 3200;

const decodeBase64 = (value?: string) => {
  if (!value) return "";
  try {
    return atob(value);
  } catch {
    return value;
  }
};

const truncate = (value: string) =>
  value.length > MAX_PREVIEW_CHARS
    ? `${value.slice(0, MAX_PREVIEW_CHARS)}\n...`
    : value;

export function FilePreview({ filename, mimeType, data }: FileMessagePartProps) {
  const preview = useMemo(() => {
    if (!data) return "";
    return truncate(decodeBase64(data));
  }, [data]);

  return (
    <div className="rounded-xl border border-[var(--da-border)] bg-[var(--da-elevated)] p-4 text-sm shadow-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.2em] text-[var(--da-muted)]">
        <span>File Preview</span>
        {filename && <span className="rounded-full bg-[var(--da-bg)] px-2 py-1">{filename}</span>}
        {mimeType && <span className="rounded-full bg-[var(--da-bg)] px-2 py-1">{mimeType}</span>}
      </div>
      <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-[var(--da-bg)] p-3 text-xs text-[color-mix(in_srgb,var(--da-text)_82%,transparent)]">
        {preview || "(empty file)"}
      </pre>
    </div>
  );
}
