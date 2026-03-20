import type {
  PolicyCheckEvent,
  PolicyCheckIssue,
  PolicyCheckScanError,
  PolicyCheckSummary,
} from "../../contexts/FilesystemContext";
import type {
  BlueprintKind,
  ProjectBlueprintCatalogItem,
  ProjectBlueprintInputSummary,
  ProjectBlueprintStep,
} from "../../api/projects/types";

export type UsageEventPayload = {
  promptTokens: number;
  completionTokens: number;
  modelId: string | null;
  modelContextWindow: number | null;
};

export interface BlueprintSuggestionsEventPayload {
  kind: BlueprintKind;
  suggestions: ProjectBlueprintCatalogItem[];
}

export interface BlueprintInputsSummaryEventPayload {
  kind: BlueprintKind;
  blueprintId: string;
  blueprintName: string;
  inputs: ProjectBlueprintInputSummary[];
}

export interface BlueprintProvenanceEventPayload {
  kind: BlueprintKind;
  source: "selection" | "run";
  runId: string | null;
  createdAt: string | null;
  inputs: Record<string, string>;
  blueprint: ProjectBlueprintCatalogItem;
}

export function parseUsageEvent(event: unknown): UsageEventPayload | null {
  if (!event || typeof event !== "object") return null;
  const raw = event as Record<string, unknown>;
  const promptTokens = typeof raw.promptTokens === "number" ? raw.promptTokens : null;
  const completionTokens = typeof raw.completionTokens === "number" ? raw.completionTokens : null;
  if (promptTokens === null || completionTokens === null) return null;

  return {
    promptTokens,
    completionTokens,
    modelId: typeof raw.modelId === "string" ? raw.modelId : null,
    modelContextWindow:
      typeof raw.modelContextWindow === "number" ? raw.modelContextWindow : null,
  };
}

function readChangedPaths(event: Record<string, unknown>): string[] {
  return Array.isArray(event.changedPaths)
    ? event.changedPaths.filter((item: unknown): item is string => typeof item === "string")
    : [];
}

export function parsePolicyCheckStartEvent(event: Record<string, unknown>): PolicyCheckEvent {
  return {
    type: "policy.check.start",
    changedPaths: readChangedPaths(event),
  };
}

function mapPolicyIssue(raw: unknown): PolicyCheckIssue | null {
  if (!raw || typeof raw !== "object") return null;
  const issue = raw as Record<string, unknown>;
  const source = issue.source === "secret" ? "secret" : "misconfig";
  const severity = readString(issue.severity, "UNKNOWN");
  const message = readIssueMessage(issue);
  return {
    source,
    severity,
    message,
    title: readOptionalString(issue.title),
    ruleId: readOptionalString(issue.rule_id) ?? readOptionalString(issue.ruleId),
    path: readOptionalString(issue.path),
    line: readOptionalNumber(issue.line),
    endLine: readOptionalNumber(issue.end_line) ?? readOptionalNumber(issue.endLine),
    referenceUrl: readOptionalString(issue.reference_url) ?? readOptionalString(issue.referenceUrl),
  } satisfies PolicyCheckIssue;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function readIssueMessage(issue: Record<string, unknown>): string {
  const message = readOptionalString(issue.message);
  if (message) return message;
  const title = readOptionalString(issue.title);
  return title || "Security issue found";
}

function parsePolicySummary(event: Record<string, unknown>, issues: PolicyCheckIssue[]): PolicyCheckSummary {
  const rawSummary = event.summary;
  if (rawSummary && typeof rawSummary === "object") {
    const summary = rawSummary as Record<string, unknown>;
    return {
      total: typeof summary.total === "number" ? summary.total : issues.length,
      bySeverity: summary.bySeverity ? (summary.bySeverity as Record<string, number>) : {},
    };
  }
  return { total: issues.length, bySeverity: {} };
}

function parsePolicyScanError(event: Record<string, unknown>): PolicyCheckScanError | null {
  if (!event.scanError || typeof event.scanError !== "object") return null;
  const rawError = event.scanError as Record<string, unknown>;
  if (typeof rawError.code === "string" && typeof rawError.message === "string") {
    return { code: rawError.code, message: rawError.message };
  }
  return null;
}

export function parsePolicyCheckResultEvent(event: Record<string, unknown>): PolicyCheckEvent {
  const issues: PolicyCheckIssue[] = Array.isArray(event.issues)
    ? event.issues
        .map(mapPolicyIssue)
        .filter((item: PolicyCheckIssue | null): item is PolicyCheckIssue => item !== null)
    : [];

  return {
    type: "policy.check.result",
    changedPaths: readChangedPaths(event),
    issues,
    summary: parsePolicySummary(event, issues),
    scanError: parsePolicyScanError(event),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readBlueprintKind(value: unknown): BlueprintKind {
  return value === "configuration" ? "configuration" : "provisioning";
}

function readBlueprintInput(raw: unknown): ProjectBlueprintInputSummary {
  const item = asRecord(raw);
  return {
    key: readString(item.key, ""),
    label: readString(item.label, ""),
    description: readOptionalString(item.description),
    required: Boolean(item.required),
    riskClass: (readOptionalString(item.riskClass) ?? "safe") as ProjectBlueprintInputSummary["riskClass"],
    defaultValue: readOptionalString(item.defaultValue) ?? null,
    resolved: Boolean(item.resolved),
    value: readOptionalString(item.value) ?? null,
  };
}

function readBlueprintStep(raw: unknown): ProjectBlueprintStep {
  const step = asRecord(raw);
  return {
    id: readString(step.id, ""),
    type: (readOptionalString(step.type) ?? "action") as ProjectBlueprintStep["type"],
    title: readString(step.title, ""),
    description: readString(step.description, ""),
    requiredInputs: Array.isArray(step.requiredInputs)
      ? step.requiredInputs.filter((item: unknown): item is string => typeof item === "string")
      : [],
    expectedResult: readString(step.expectedResult, ""),
  };
}

function readBlueprintPayload(raw: unknown): ProjectBlueprintCatalogItem {
  const payload = asRecord(raw);
  return {
    id: readString(payload.id, ""),
    kind: readBlueprintKind(payload.kind),
    name: readString(payload.name, ""),
    summary: readString(payload.summary, ""),
    resourcesOrActions: Array.isArray(payload.resourcesOrActions)
      ? payload.resourcesOrActions.filter((item: unknown): item is string => typeof item === "string")
      : [],
    requiredInputs: Array.isArray(payload.requiredInputs)
      ? payload.requiredInputs.map(readBlueprintInput)
      : [],
    steps: Array.isArray(payload.steps) ? payload.steps.map(readBlueprintStep) : [],
  };
}

function readStringMap(raw: unknown): Record<string, string> {
  const value = asRecord(raw);
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return Object.fromEntries(entries);
}

export function parseBlueprintSuggestionsEvent(
  event: Record<string, unknown>,
): BlueprintSuggestionsEventPayload {
  return {
    kind: readBlueprintKind(event.kind),
    suggestions: Array.isArray(event.suggestions) ? event.suggestions.map(readBlueprintPayload) : [],
  };
}

export function parseBlueprintInputsSummaryEvent(
  event: Record<string, unknown>,
): BlueprintInputsSummaryEventPayload {
  return {
    kind: readBlueprintKind(event.kind),
    blueprintId: readString(event.blueprintId, ""),
    blueprintName: readString(event.blueprintName, ""),
    inputs: Array.isArray(event.inputs) ? event.inputs.map(readBlueprintInput) : [],
  };
}

export function parseBlueprintProvenanceEvent(
  event: Record<string, unknown>,
): BlueprintProvenanceEventPayload {
  return {
    kind: readBlueprintKind(event.kind),
    source: event.source === "run" ? "run" : "selection",
    runId: readOptionalString(event.runId) ?? null,
    createdAt: readOptionalString(event.createdAt) ?? null,
    inputs: readStringMap(event.inputs),
    blueprint: readBlueprintPayload(event.blueprint),
  };
}
