import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import { CheckCircle2, LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";

import { DataTable } from "../tool-ui/data-table";
import { safeParseSerializableDataTable } from "../tool-ui/data-table/schema";
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
const FILE_ACTION_RUNNING_TITLES: Record<string, string> = {
  delete_file: "Deleting file",
  edit_file: "Editing file",
  read_file: "Reading file",
  write_file: "Creating file",
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

type InfraCostModule = {
  name: string;
  monthly_cost: number;
};

type InfraCostResource = {
  id: string;
  module: string;
  resource_name: string;
  resource_type: string;
  quantity: number;
  unit: string;
  monthly_cost: number;
};

type InfraCostPayload = {
  status: "ok" | "error";
  message?: string;
  scope?: string;
  currency?: string;
  total_monthly_cost?: number;
  modules?: InfraCostModule[];
  resources?: InfraCostResource[];
  warnings?: string[];
  available_modules?: string[];
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

function readInfraCostPayload(value: unknown): InfraCostPayload | null {
  if (!isRecord(value)) return null;
  return value.status === "ok" || value.status === "error" ? (value as InfraCostPayload) : null;
}

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount || 0);
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

function fileActionTitle(toolName: string, status: string) {
  if (status === "running" && FILE_ACTION_RUNNING_TITLES[toolName]) {
    return FILE_ACTION_RUNNING_TITLES[toolName];
  }
  return toBriefTitle(toolName);
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
  const title = fileActionTitle(toolName, getToolCallStatus(props));
  if (FILE_ACTION_TITLES[toolName]) return { title, rows: fileRows(props) };
  const docRows = isDocumentationTool(toolName) ? collectionRows(props.result, props.args) : [];
  if (docRows.length > 0) return { title, rows: docRows };
  return { title, rows: collectionRows(props.result, props.args) };
}

function buildInfraCostTablePayload(payload: InfraCostPayload, toolCallId: string) {
  return {
    id: `${toolCallId}-infra-costs`,
    columns: [
      { key: "module", label: "Module", priority: "primary" as const },
      { key: "resource", label: "Resource", priority: "primary" as const },
      { key: "quantity", label: "Quantity", align: "right" as const, format: { kind: "number", decimals: 2 } },
      { key: "unit", label: "Units" },
      { key: "monthlyCost", label: "Monthly Cost", align: "right" as const, format: { kind: "currency", currency: payload.currency || "USD" } },
    ],
    data: (payload.resources ?? []).map((resource) => ({
      id: resource.id,
      module: resource.module,
      resource: `${resource.resource_type}.${resource.resource_name}`,
      quantity: resource.quantity,
      unit: resource.unit || "-",
      monthlyCost: resource.monthly_cost,
    })),
    rowIdKey: "id",
    defaultSort: { by: "monthlyCost", direction: "desc" as const },
    emptyMessage: "No cost data yet.",
    maxHeight: "24rem",
    locale: "en-US",
  };
}

function buildInfraCostSummaryRows(payload: InfraCostPayload): ToolBriefRow[] {
  return (payload.modules ?? []).map((module) => ({
    label: module.name,
    meta: formatMoney(module.monthly_cost, payload.currency || "USD"),
  }));
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

function CompactFileActionCard({
  title,
  row,
  status,
}: {
  title: string;
  row: ToolBriefRow;
  status: string;
}) {
  const isRunning = status === "running";
  return (
    <div className="rounded-2xl border border-[var(--da-border)] bg-[var(--da-elevated)] px-4 py-3">
      <div className="flex items-center gap-3 text-sm">
        {isRunning ? (
          <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-[var(--da-accent)]" />
        ) : (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[var(--da-text)]">{title}</span>
            {isRunning ? <span className="text-xs text-[var(--da-muted)]">Streaming…</span> : null}
          </div>
          <div className="truncate text-[var(--da-text)]">{row.label}</div>
        </div>
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

function InfraCostToolCard(props: ToolCallMessagePartProps) {
  const status = getToolCallStatus(props);
  const payload = readInfraCostPayload(props.result);
  const [sort, setSort] = useState<{ by?: string; direction?: "asc" | "desc" }>({
    by: "monthlyCost",
    direction: "desc",
  });
  const table = useMemo(
    () =>
      payload
        ? safeParseSerializableDataTable(buildInfraCostTablePayload(payload, props.toolCallId ?? "infra-costs"))
        : null,
    [payload, props.toolCallId],
  );
  if (!payload) {
    return (
      <Card className="overflow-hidden border-[var(--da-border)] bg-[var(--da-elevated)]">
        <DetailedToolHeader title="Infra Costs" status={status} />
        <CardContent className="space-y-4 pt-5">
          <p className="text-sm text-[var(--da-muted)]">
            {status === "running" ? "Fetching infrastructure cost breakdown…" : "Waiting for cost data…"}
          </p>
        </CardContent>
      </Card>
    );
  }
  const warnings = (payload.warnings ?? []).filter(Boolean);
  const availableModules = (payload.available_modules ?? []).filter(Boolean);
  return (
    <Card className="overflow-hidden border-[var(--da-border)] bg-[var(--da-elevated)]">
      <DetailedToolHeader title="Infra Costs" status={status} />
      <CardContent className="space-y-4 pt-5">
        <div className="rounded-xl border border-[var(--da-border)] bg-[var(--da-bg)] px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--da-muted)]">Estimated monthly cost</p>
              <p className="text-2xl font-semibold text-[var(--da-text)]">
                {formatMoney(readNumber(payload.total_monthly_cost) ?? 0, payload.currency || "USD")}/mo
              </p>
            </div>
            <Badge variant="outline">Scope {readString(payload.scope) || "all"}</Badge>
          </div>
        </div>
        {payload.status === "error" ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700">
            {readString(payload.message) || "Failed to load infra costs."}
          </div>
        ) : null}
        <ToolBriefRows rows={buildInfraCostSummaryRows(payload)} />
        {payload.status === "ok" && table ? (
          <DataTable
            {...table}
            sort={sort}
            onSortChange={(next) => setSort({ by: next.by, direction: next.direction })}
          />
        ) : null}
        {warnings.length > 0 ? (
          <div className="space-y-1 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-700">
            {warnings.map((warning) => <p key={warning}>{warning}</p>)}
          </div>
        ) : null}
        {availableModules.length > 0 ? (
          <p className="text-xs text-[var(--da-muted)]">Available modules: {availableModules.join(", ")}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ToolCallCard(props: ToolCallMessagePartProps) {
  const status = getToolCallStatus(props);
  const metadata = readMetadata(props);
  const toolName = resolveToolKey(props);
  const artifactPreview = useArtifactPreview(props.artifact);
  if (toolName === "get_infra_costs") return <InfraCostToolCard {...props} />;
  const brief = buildToolBrief(props);
  const title = brief.title;
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
    return <CompactFileActionCard title={title} row={brief.rows[0]} status={status} />;
  }

  return (
    <Card className="overflow-hidden border-[var(--da-border)] bg-[var(--da-elevated)]">
      {compactBrief ? (
        <CompactToolHeader title={title} status={status} />
      ) : (
        <DetailedToolHeader title={title} status={status} severity={metadata.severity} fixClass={metadata.fixClass} />
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
