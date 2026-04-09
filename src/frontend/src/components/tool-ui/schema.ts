import type { ReactNode } from "react";

export type Action = {
  id: string;
  label: string;
  confirmLabel?: string;
  variant?: "default" | "destructive" | "secondary" | "ghost" | "outline";
  icon?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  shortcut?: string;
};

export type MetadataItem = {
  key: string;
  value: string;
};

export type ApprovalDecision = "approved" | "denied";

export type SerializableApprovalCard = {
  id: string;
  role?: string;
  title: string;
  description?: string;
  icon?: string;
  metadata?: MetadataItem[];
  variant?: "default" | "destructive";
  confirmLabel?: string;
  cancelLabel?: string;
  choice?: ApprovalDecision;
};

export type ApprovalCardProps = SerializableApprovalCard & {
  className?: string;
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void | Promise<void>;
};

export type ProgressStepStatus =
  | "pending"
  | "in-progress"
  | "completed"
  | "failed";

export type ProgressStep = {
  id: string;
  label: string;
  description?: string;
  status: ProgressStepStatus;
};

export type ProgressTrackerChoice = {
  outcome: "success" | "partial" | "failed" | "cancelled";
  summary: string;
};

export type ProgressTrackerProps = {
  id: string;
  role?: string;
  steps: ProgressStep[];
  elapsedTime?: number;
  choice?: ProgressTrackerChoice;
  className?: string;
};

export type TerminalProps = {
  id: string;
  role?: string;
  command: string;
  stdout?: string;
  stderr?: string;
  exitCode: number;
  durationMs?: number;
  cwd?: string;
  truncated?: boolean;
  maxCollapsedLines?: number;
  className?: string;
};

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function safeParseSerializableApprovalCard(
  value: unknown,
): SerializableApprovalCard | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = readString(record.id);
  const title = readString(record.title);
  if (!id || !title) return null;
  const metadata = Array.isArray(record.metadata)
    ? record.metadata
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return null;
          const metadataRecord = item as Record<string, unknown>;
          const key = readString(metadataRecord.key);
          const itemValue = readString(metadataRecord.value) ?? String(metadataRecord.value ?? "");
          return key ? { key, value: itemValue } : null;
        })
        .filter((item): item is MetadataItem => item !== null)
    : undefined;
  return {
    id,
    title,
    role: readString(record.role) ?? undefined,
    description: readString(record.description) ?? undefined,
    icon: readString(record.icon) ?? undefined,
    metadata,
    variant: record.variant === "destructive" ? "destructive" : "default",
    confirmLabel: readString(record.confirmLabel) ?? undefined,
    cancelLabel: readString(record.cancelLabel) ?? undefined,
    choice:
      record.choice === "approved" || record.choice === "denied"
        ? record.choice
        : undefined,
  };
}

export function safeParseTerminal(value: unknown): TerminalProps | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = readString(record.id);
  const command = readString(record.command);
  const exitCode = readNumber(record.exitCode);
  if (!id || !command || exitCode === null) return null;
  return {
    id,
    command,
    exitCode,
    role: readString(record.role) ?? undefined,
    stdout: readString(record.stdout) ?? undefined,
    stderr: readString(record.stderr) ?? undefined,
    cwd: readString(record.cwd) ?? undefined,
    durationMs: readNumber(record.durationMs) ?? undefined,
    truncated: typeof record.truncated === "boolean" ? record.truncated : undefined,
    maxCollapsedLines:
      typeof record.maxCollapsedLines === "number"
        ? record.maxCollapsedLines
        : undefined,
  };
}
