import type {
  PolicyCheckEvent,
  PolicyCheckIssue,
  PolicyCheckScanError,
  PolicyCheckSummary,
} from "../../contexts/FilesystemContext";

export interface EvidenceBundleEventPayload {
  schemaVersion: number;
  changedFiles: string[];
  validationsRun: string[];
  passFailEvidence: string[];
  unresolvedRisks: string[];
  completionRationale: string[];
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

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item: unknown): item is string => typeof item === "string")
    : [];
}

export function parseEvidenceBundleEvent(event: Record<string, unknown>): EvidenceBundleEventPayload {
  return {
    schemaVersion: typeof event.schemaVersion === "number" ? event.schemaVersion : 1,
    changedFiles: readStringList(event.changedFiles),
    validationsRun: readStringList(event.validationsRun),
    passFailEvidence: readStringList(event.passFailEvidence),
    unresolvedRisks: readStringList(event.unresolvedRisks),
    completionRationale: readStringList(event.completionRationale),
  };
}
