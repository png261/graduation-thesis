import type {
  PolicyCheckEvent,
  PolicyCheckIssue,
  PolicyCheckScanError,
  PolicyCheckSummary,
} from "../../contexts/FilesystemContext";

export type UsageEventPayload = {
  promptTokens: number;
  completionTokens: number;
  modelId: string | null;
  modelContextWindow: number | null;
};

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
  const severity = typeof issue.severity === "string" ? issue.severity : "UNKNOWN";
  const message =
    typeof issue.message === "string" && issue.message
      ? issue.message
      : typeof issue.title === "string" && issue.title
        ? issue.title
        : "Security issue found";

  return {
    source,
    severity,
    message,
    title: typeof issue.title === "string" ? issue.title : undefined,
    ruleId:
      typeof issue.rule_id === "string"
        ? issue.rule_id
        : typeof issue.ruleId === "string"
          ? issue.ruleId
          : undefined,
    path: typeof issue.path === "string" ? issue.path : undefined,
    line: typeof issue.line === "number" ? issue.line : undefined,
    endLine:
      typeof issue.end_line === "number"
        ? issue.end_line
        : typeof issue.endLine === "number"
          ? issue.endLine
          : undefined,
    referenceUrl:
      typeof issue.reference_url === "string"
        ? issue.reference_url
        : typeof issue.referenceUrl === "string"
          ? issue.referenceUrl
          : undefined,
  } satisfies PolicyCheckIssue;
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
