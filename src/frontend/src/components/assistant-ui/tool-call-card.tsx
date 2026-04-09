import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import { ArrowUpRight, CheckCircle2 } from "lucide-react";
import { useMemo } from "react";

import { Terminal } from "../tool-ui";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

const MAX_PREVIEW_CHARS = 2400;
const MAX_BRIEF_ROWS = 6;
const FILE_ACTION_TITLES: Record<string, string> = {
  delete_file: "Deleted file",
  edit_file: "Edited file",
  read_file: "Read file",
  write_file: "Created file",
};
const COLLECTION_KEYS = ["documents", "files", "items", "paths", "resources", "results", "targets"];

type StructuredToolCallProps = ToolCallMessagePartProps & {
  schemaVersion?: number;
  sourceTool?: string;
  severity?: string;
  fixClass?: string;
  diagnostic?: Record<string, unknown>;
};

type ToolBriefRow = {
  label: string;
  meta?: string;
  tone?: "default" | "success";
};

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

function getStatusTone(status: string) {
  if (status === "error") return "destructive" as const;
  if (status === "running") return "secondary" as const;
  return "outline" as const;
}

function toTitleCase(value: string) {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : "";
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readMetadata(props: ToolCallMessagePartProps) {
  const structured = props as StructuredToolCallProps;
  return {
    schemaVersion: typeof structured.schemaVersion === "number" ? structured.schemaVersion : undefined,
    sourceTool: readString(structured.sourceTool),
    severity: readString(structured.severity),
    fixClass: readString(structured.fixClass),
    diagnostic: isRecord(structured.diagnostic) ? structured.diagnostic : null,
  };
}

function looksLikeTerminalResult(value: unknown) {
  if (!isRecord(value)) return false;
  return typeof value.command === "string" && typeof value.exitCode === "number";
}

function resolveToolKey(props: ToolCallMessagePartProps) {
  const metadata = readMetadata(props);
  return readString(props.toolName) || metadata.sourceTool || "tool";
}

function isDocumentationTool(toolName: string) {
  return ["documentation", "module", "provider", "registry", "resource"].some((part) => toolName.includes(part));
}

function toBriefTitle(toolName: string) {
  if (FILE_ACTION_TITLES[toolName]) return FILE_ACTION_TITLES[toolName];
  if (isDocumentationTool(toolName)) return "Read resource documentation";
  return toTitleCase(toolName);
}

function buildTerminalResult(props: ToolCallMessagePartProps, resultText: string) {
  if (looksLikeTerminalResult(props.result)) {
    const result = props.result as Record<string, unknown>;
    return {
      id: props.toolCallId ?? props.toolName ?? "tool-result",
      command: readString(result.command) || props.toolName || "tool",
      cwd: readString(result.cwd) || undefined,
      stdout: readString(result.stdout) || undefined,
      stderr: readString(result.stderr) || undefined,
      exitCode: Number(result.exitCode ?? 0),
      durationMs: typeof result.durationMs === "number" ? result.durationMs : undefined,
      truncated: typeof result.truncated === "boolean" ? result.truncated : undefined,
      maxCollapsedLines: 10,
    };
  }
  if (!resultText.includes("\n") && resultText.length < 160) return null;
  return {
    id: props.toolCallId ?? props.toolName ?? "tool-result",
    command: props.toolName ?? "tool",
    stdout: props.isError ? undefined : resultText,
    stderr: props.isError ? resultText : undefined,
    exitCode: props.isError ? 1 : 0,
    maxCollapsedLines: 12,
  };
}

function useArtifactPreview(artifact: unknown) {
  return useMemo(() => {
    if (!isRecord(artifact)) return null;
    const data = artifact.dataBase64 as string | undefined;
    if (!data) return null;
    return truncate(decodeBase64(data));
  }, [artifact]);
}

function readPathValues(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const direct = ["file", "filename", "path"]
    .map((key) => readString(value[key]))
    .filter(Boolean);
  const listed = ["files", "paths"].flatMap((key) =>
    Array.isArray(value[key]) ? value[key].map(readString).filter(Boolean) : [],
  );
  return [...direct, ...listed];
}

function uniqueRows(rows: ToolBriefRow[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.label}::${row.meta ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function primaryCollectionLabel(value: Record<string, unknown>) {
  const provider = readString(value.provider);
  const resource = readString(value.resource) || readString(value.resourceType) || readString(value.name);
  if (provider && resource) return `${provider}/${resource}`;
  return (
    readString(value.title) ||
    readString(value.label) ||
    readString(value.name) ||
    readString(value.path) ||
    readString(value.target) ||
    readString(value.id)
  );
}

function rowMeta(value: Record<string, unknown>) {
  const explicit = readNumber(value.linesRead) || readNumber(value.lineCount) || readNumber(value.readLines);
  if (explicit !== null) return `${explicit} lines read`;
  const content = readString(value.content) || readString(value.text) || readString(value.body);
  return content ? `${content.split("\n").length} lines read` : undefined;
}

function readCollectionItems(values: unknown[]) {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) return value;
    if (!isRecord(value)) continue;
    const key = COLLECTION_KEYS.find((item) => Array.isArray(value[item]) && value[item].length > 0);
    if (key) return value[key] as unknown[];
  }
  return [];
}

function collectionRows(...values: unknown[]): ToolBriefRow[] {
  const items = readCollectionItems(values);
  return uniqueRows(
    items
      .map((item) =>
        typeof item === "string"
          ? { label: item }
          : isRecord(item) && primaryCollectionLabel(item)
            ? { label: primaryCollectionLabel(item), meta: rowMeta(item) }
            : null,
      )
      .filter((item): item is ToolBriefRow => item !== null)
      .slice(0, MAX_BRIEF_ROWS),
  );
}

function fileRows(props: ToolCallMessagePartProps): ToolBriefRow[] {
  return uniqueRows(
    [...readPathValues(props.args), ...readPathValues(props.result)]
      .filter(Boolean)
      .map((path) => ({ label: path, tone: "success" as const }))
      .slice(0, MAX_BRIEF_ROWS),
  );
}

function buildToolBrief(props: ToolCallMessagePartProps) {
  const toolName = resolveToolKey(props);
  const title = toBriefTitle(toolName);
  if (FILE_ACTION_TITLES[toolName]) return { title, rows: fileRows(props) };
  const docRows = isDocumentationTool(toolName) ? collectionRows(props.result, props.args) : [];
  if (docRows.length > 0) return { title, rows: docRows };
  return { title, rows: collectionRows(props.result, props.args) };
}

function ToolCallSection({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--da-muted)]">{label}</p>
      <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-[var(--da-bg)] p-3 text-xs text-[color-mix(in_srgb,var(--da-text)_82%,transparent)]">{value}</pre>
    </div>
  );
}

function ToolBriefRows({ rows }: { rows: ToolBriefRow[] }) {
  if (rows.length < 1) return null;
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div
          key={`${row.label}-${row.meta ?? ""}`}
          className="flex items-center justify-between gap-3 rounded-xl border border-[var(--da-border)] bg-[var(--da-bg)] px-4 py-3 text-sm"
        >
          <div className="flex min-w-0 items-center gap-3">
            {row.tone === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : null}
            <span className={row.tone === "success" ? "truncate font-medium text-[var(--da-text)]" : "truncate text-[var(--da-text)]"}>
              {row.label}
            </span>
          </div>
          {row.meta ? <span className="shrink-0 text-xs text-[var(--da-muted)]">{row.meta}</span> : null}
        </div>
      ))}
    </div>
  );
}

function CompactFileActionCard({ title, row }: { title: string; row: ToolBriefRow }) {
  return (
    <div className="rounded-2xl border border-[var(--da-border)] bg-[var(--da-elevated)] px-4 py-3">
      <div className="flex items-center gap-3 text-sm">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
        <span className="font-semibold text-[var(--da-text)]">{title}:</span>
        <span className="min-w-0 flex-1 truncate text-[var(--da-text)]">{row.label}</span>
        <ArrowUpRight className="h-4 w-4 shrink-0 text-[var(--da-muted)]" />
      </div>
    </div>
  );
}

function isCompactBrief(
  props: ToolCallMessagePartProps,
  rows: ToolBriefRow[],
  hasTerminal: boolean,
  hasDiagnostic: boolean,
  hasArtifact: boolean,
) {
  return rows.length > 0 && !props.isError && !hasTerminal && !hasDiagnostic && !hasArtifact;
}

function CompactToolHeader({ title, status }: { title: string; status: string }) {
  return (
    <CardHeader className="space-y-1 border-b border-[var(--da-border)] pb-4">
      <CardTitle className="text-lg font-semibold text-[var(--da-text)]">{title}</CardTitle>
      {status === "running" ? <p className="text-sm text-[var(--da-muted)]">Fetching tool details…</p> : null}
    </CardHeader>
  );
}

function DetailedToolHeader({
  title,
  status,
  severity,
  fixClass,
}: {
  title: string;
  status: string;
  severity?: string;
  fixClass?: string;
}) {
  return (
    <CardHeader className="space-y-3 border-b border-[var(--da-border)] pb-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Tool</Badge>
            <CardTitle className="text-base">{title}</CardTitle>
            {severity ? <Badge variant="secondary">{toTitleCase(severity)}</Badge> : null}
            {fixClass ? <Badge variant="outline">Fix {toTitleCase(fixClass)}</Badge> : null}
          </div>
          <p className="text-sm text-[var(--da-muted)]">
            {status === "running" ? "Executing tool call" : status === "error" ? "Tool call returned an error" : "Tool call finished"}
          </p>
        </div>
        <Badge variant={getStatusTone(status)}>{toTitleCase(status)}</Badge>
      </div>
    </CardHeader>
  );
}

export function ToolCallCard(props: ToolCallMessagePartProps) {
  const status = getToolCallStatus(props);
  const metadata = readMetadata(props);
  const toolName = resolveToolKey(props);
  const artifactPreview = useArtifactPreview(props.artifact);
  const brief = buildToolBrief(props);
  const resultText = props.result ? formatValue(props.result) : "";
  const terminalResult = buildTerminalResult(props, resultText);
  const compactBrief = isCompactBrief(
    props,
    brief.rows,
    Boolean(terminalResult),
    Boolean(metadata.diagnostic),
    Boolean(artifactPreview),
  );
  const showResult = !terminalResult && (props.isError || (!compactBrief && brief.rows.length < 1));

  if (FILE_ACTION_TITLES[toolName] && compactBrief && brief.rows.length === 1) {
    return <CompactFileActionCard title={brief.title} row={brief.rows[0]} />;
  }

  return (
    <Card className="overflow-hidden border-[var(--da-border)] bg-[var(--da-elevated)]">
      {compactBrief ? (
        <CompactToolHeader title={brief.title} status={status} />
      ) : (
        <DetailedToolHeader title={brief.title} status={status} severity={metadata.severity} fixClass={metadata.fixClass} />
      )}
      <CardContent className="space-y-4 pt-5">
        <ToolBriefRows rows={brief.rows} />
        {terminalResult ? <Terminal {...terminalResult} className="max-w-none min-w-0" /> : null}
        {metadata.diagnostic ? <ToolCallSection label="Diagnostic" value={truncate(formatValue(metadata.diagnostic))} /> : null}
        {showResult ? <ToolCallSection label="Result" value={resultText ? truncate(resultText) : "Waiting for tool output..."} /> : null}
        {artifactPreview ? <ToolCallSection label="Artifact Preview" value={artifactPreview} /> : null}
      </CardContent>
    </Card>
  );
}
