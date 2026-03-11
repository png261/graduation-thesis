import { useMemo } from "react";
import { useThread } from "@assistant-ui/react";

import { cn } from "../../lib/utils";

const DEFAULT_MODEL_ID = "gemini-2.5-flash";
const DEFAULT_MODEL_CONTEXT_WINDOW = 1_048_576;

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(value);
}

type UsageState = {
  usedTokens: number;
  modelContextWindow: number | null;
  modelId: string | null;
};

function readPromptTokensFromSteps(steps: readonly { usage?: { promptTokens?: number } }[] | undefined) {
  if (!Array.isArray(steps)) return null;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const promptTokens = asNumber(steps[index]?.usage?.promptTokens);
    if (promptTokens !== null) return promptTokens;
  }
  return null;
}

function mergeModelMetadata(
  custom: Record<string, unknown> | undefined,
  modelContextWindow: number | null,
  modelId: string | null,
) {
  return {
    modelContextWindow: modelContextWindow ?? asNumber(custom?.modelContextWindow),
    modelId: modelId ?? asString(custom?.modelId),
  };
}

function scanAssistantUsage(messages: readonly {
  role: string;
  metadata?: {
    custom?: Record<string, unknown>;
    steps?: readonly { usage?: { promptTokens?: number } }[];
  };
}[]) {
  let modelContextWindow: number | null = null;
  let modelId: string | null = null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const metadata = mergeModelMetadata(message.metadata?.custom as Record<string, unknown> | undefined, modelContextWindow, modelId);
    modelContextWindow = metadata.modelContextWindow;
    modelId = metadata.modelId;
    const promptTokens = readPromptTokensFromSteps(message.metadata?.steps);
    if (promptTokens !== null) return { usedTokens: promptTokens, modelContextWindow, modelId };
  }
  return { usedTokens: 0, modelContextWindow, modelId };
}

function deriveUsageState(messages: readonly {
  role: string;
  metadata?: {
    custom?: Record<string, unknown>;
    steps?: readonly { usage?: { promptTokens?: number } }[];
  };
}[]): UsageState {
  const scanned = scanAssistantUsage(messages);
  return { usedTokens: scanned.usedTokens, modelContextWindow: scanned.modelContextWindow ?? DEFAULT_MODEL_CONTEXT_WINDOW, modelId: scanned.modelId ?? DEFAULT_MODEL_ID };
}

export function ContextDisplay({ className }: { className?: string }) {
  const messages = useThread((thread) => thread.messages);
  const usage = useMemo(() => deriveUsageState(messages), [messages]);
  const windowSize = usage.modelContextWindow;

  if (!windowSize || windowSize <= 0) {
    return (
      <div className={cn("context-display-root", className)} data-state="empty">
        <span className="context-display-empty">Unavailable</span>
      </div>
    );
  }

  const used = Math.max(usage.usedTokens, 0);
  const percentage = Math.min(100, Math.max(0, (used / windowSize) * 100));
  const percentageLabel = percentage > 0 && percentage < 1 ? "<1" : `${Math.round(percentage)}`;

  return (
    <div
      className={cn("context-display-root", className)}
      aria-label="Context window usage"
      title={usage.modelId ?? undefined}
    >
      <div className="context-display-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percentage)}>
        <span className="context-display-fill" style={{ width: `${percentage}%` }} />
      </div>
      <span className="context-display-value">{`${formatTokenCount(used)} (${percentageLabel}%)`}</span>
    </div>
  );
}
