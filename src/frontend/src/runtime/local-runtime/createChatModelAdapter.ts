import type {
  ChatModelAdapter,
  ThreadAssistantMessagePart,
  ToolCallMessagePart,
} from "@assistant-ui/react";

import { API_URL } from "../../api/client";
import type { PolicyCheckEvent } from "../../contexts/FilesystemContext";
import { persistThread } from "../../api/projects";
import { readSseJson } from "../../lib/sse";
import {
  parsePolicyCheckResultEvent,
  parsePolicyCheckStartEvent,
  parseUsageEvent,
  type UsageEventPayload,
} from "./chatAdapterEvents";

const MUTATING_TOOL_NAMES = new Set([
  "write_file",
  "edit_file",
  "delete_file",
  "create_directory",
  "move_path",
  "copy_path",
  "delete_path",
]);

function normalizeChangedPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function extractChangedPaths(result: unknown): string[] {
  if (!result || typeof result !== "object") return [];
  const payload = result as Record<string, unknown>;
  const candidates: string[] = [];

  const list = payload.changed_paths;
  if (Array.isArray(list)) {
    for (const item of list) {
      const normalized = normalizeChangedPath(item);
      if (normalized) candidates.push(normalized);
    }
  }

  for (const key of ["path", "source_path", "destination_path"] as const) {
    const normalized = normalizeChangedPath(payload[key]);
    if (normalized) candidates.push(normalized);
  }

  return [...new Set(candidates)];
}

function appendDeltaPart(
  parts: ThreadAssistantMessagePart[],
  index: number | null,
  type: "text" | "reasoning",
  delta: string,
): number {
  if (index === null) {
    parts.push({ type, text: delta });
    return parts.length - 1;
  }

  const current = parts[index] as ThreadAssistantMessagePart & { text?: string };
  parts[index] = {
    ...current,
    type,
    text: `${current.text ?? ""}${delta}`,
  };
  return index;
}

function asJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function createChatModelAdapter({
  getProjectId,
  authenticated,
  notifyFileChanged,
  notifyPolicyCheck,
}: {
  getProjectId: () => string;
  authenticated: boolean;
  notifyFileChanged: (path?: string) => void;
  notifyPolicyCheck: (event: PolicyCheckEvent) => void;
}): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal, unstable_threadId }) {
      const backendThreadId = unstable_threadId ?? crypto.randomUUID();

      if (authenticated && !unstable_threadId) {
        persistThread(getProjectId(), backendThreadId, "").catch(() => {});
      }

      const payload = {
        ...(authenticated ? { project_id: getProjectId() } : {}),
        ...(authenticated ? { thread_id: backendThreadId } : {}),
        messages: messages.map((message) => ({
          role: message.role,
          content: message.content
            .map((part) => (part.type === "text" ? part.text : ""))
            .join(""),
        })),
      };

      const response = await fetch(`${API_URL}/api/chat/stream`, {
        method: "POST",
        credentials: authenticated ? "include" : "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: abortSignal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`API error (${response.status})`);
      }

      const parts: ThreadAssistantMessagePart[] = [];
      const toolCallIndex = new Map<string, number>();
      let textIndex: number | null = null;
      let reasoningIndex: number | null = null;
      let usageEvent: UsageEventPayload | null = null;

      const emit = () => ({ content: [...parts] });

      for await (const rawEvent of readSseJson(response)) {
        const event = (rawEvent ?? {}) as Record<string, unknown>;
        const type = event.type ?? (event.delta ? "text.delta" : null);

        if (type === "error") {
          throw new Error((event.message as string | undefined) ?? "stream_failed");
        }

        if (type === "text.delta") {
          const delta = String(event.delta ?? "");
          if (!delta) continue;
          textIndex = appendDeltaPart(parts, textIndex, "text", delta);
          yield emit();
          continue;
        }

        if (type === "reasoning.delta") {
          const delta = String(event.delta ?? "");
          if (!delta) continue;
          reasoningIndex = appendDeltaPart(parts, reasoningIndex, "reasoning", delta);
          yield emit();
          continue;
        }

        if (type === "tool.start") {
          const toolCallId = String(event.toolCallId ?? "");
          if (!toolCallId) continue;

          const part: ToolCallMessagePart = {
            type: "tool-call",
            toolCallId,
            toolName: String(event.toolName ?? "tool"),
            args: asJsonObject(event.args) as ToolCallMessagePart["args"],
            argsText: (event.argsText as string | undefined) ?? JSON.stringify(event.args ?? {}, null, 2),
          };
          toolCallIndex.set(toolCallId, parts.length);
          parts.push(part);
          yield emit();
          continue;
        }

        if (type === "tool.result") {
          const toolCallId = String(event.toolCallId ?? "");
          if (!toolCallId) continue;

          const index = toolCallIndex.get(toolCallId);
          const updated: ToolCallMessagePart = {
            type: "tool-call",
            toolCallId,
            toolName: String(event.toolName ?? "tool"),
            args: asJsonObject(event.args) as ToolCallMessagePart["args"],
            argsText: (event.argsText as string | undefined) ?? JSON.stringify(event.args ?? {}, null, 2),
            result: event.result,
            isError: (event.isError as boolean | undefined) ?? false,
            artifact: event.artifact,
          };

          if (index === undefined) {
            toolCallIndex.set(toolCallId, parts.length);
            parts.push(updated);
          } else {
            const existing = parts[index] as ToolCallMessagePart;
            parts[index] = {
              ...existing,
              ...updated,
              toolName: existing.toolName ?? updated.toolName,
              args: existing.args ?? updated.args,
              argsText: existing.argsText ?? updated.argsText,
            };
          }

          yield emit();

          const toolName = String(event.toolName ?? "");
          if (MUTATING_TOOL_NAMES.has(toolName)) {
            const changedPaths = extractChangedPaths(event.result);
            if (changedPaths.length === 0) {
              notifyFileChanged();
            } else {
              for (const path of changedPaths) {
                notifyFileChanged(path);
              }
            }
          }
          continue;
        }

        if (type === "file") {
          parts.push({
            type: "file",
            filename: (event.filename as string | undefined) ?? undefined,
            mimeType: (event.mimeType as string | undefined) ?? "application/octet-stream",
            data: (event.dataBase64 as string | undefined) ?? "",
          });
          yield emit();
          continue;
        }

        if (type === "policy.check.start") {
          notifyPolicyCheck(parsePolicyCheckStartEvent(event));
          continue;
        }

        if (type === "policy.check.result") {
          notifyPolicyCheck(parsePolicyCheckResultEvent(event));
          continue;
        }

        if (type === "usage") {
          usageEvent = parseUsageEvent(event);
          continue;
        }

        if (type === "done") {
          const customMetadata: Record<string, string | number> = {};
          if (usageEvent?.modelId) {
            customMetadata.modelId = usageEvent.modelId;
          }
          if (usageEvent?.modelContextWindow !== null && usageEvent?.modelContextWindow !== undefined) {
            customMetadata.modelContextWindow = usageEvent.modelContextWindow;
          }
          const metadata =
            usageEvent === null
              ? undefined
              : {
                  steps: [
                    {
                      usage: {
                        promptTokens: usageEvent.promptTokens,
                        completionTokens: usageEvent.completionTokens,
                      },
                    },
                  ],
                  ...(Object.keys(customMetadata).length > 0 ? { custom: customMetadata } : {}),
                };

          yield {
            content: [...parts],
            status: { type: "complete", reason: "stop" },
            metadata,
          };
          return;
        }
      }
    },
  };
}
