import type {
  ChatModelAdapter,
  ThreadAssistantMessagePart,
  ToolCallMessagePart,
} from "@assistant-ui/react";

import { persistThread } from "../../api/projects";
import { apiRequest } from "../../api/client";
import type { PolicyCheckEvent } from "../../contexts/FilesystemContext";
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

interface AdapterDeps {
  getProjectId: () => string;
  authenticated: boolean;
  notifyFileChanged: (path?: string) => void;
  notifyPolicyCheck: (event: PolicyCheckEvent) => void;
}

interface StreamState {
  parts: ThreadAssistantMessagePart[];
  toolCallIndex: Map<string, number>;
  textIndex: number | null;
  reasoningIndex: number | null;
  usageEvent: UsageEventPayload | null;
}

type StreamEvent = Record<string, unknown>;

type AdapterRunInput = Parameters<ChatModelAdapter["run"]>[0];
type InferRunResult<T> = T extends Promise<infer R>
  ? R
  : T extends AsyncGenerator<infer R, void, unknown>
    ? R
    : never;
type ChatRunResult = InferRunResult<ReturnType<ChatModelAdapter["run"]>>;

type HandlerResult = { output?: ChatRunResult; done?: boolean; completion?: ChatRunResult };

function normalizeChangedPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function extractChangedPaths(result: unknown): string[] {
  if (!result || typeof result !== "object") return [];
  const payload = result as Record<string, unknown>;
  const candidates = collectChangedPathCandidates(payload);
  return [...new Set(candidates)];
}

function collectChangedPathCandidates(payload: Record<string, unknown>): string[] {
  const candidates: string[] = [];
  const list = payload.changed_paths;
  if (Array.isArray(list)) addArrayChangedPaths(candidates, list);
  addKeyChangedPaths(candidates, payload);
  return candidates;
}

function addArrayChangedPaths(candidates: string[], values: unknown[]) {
  for (const item of values) {
    const normalized = normalizeChangedPath(item);
    if (normalized) candidates.push(normalized);
  }
}

function addKeyChangedPaths(candidates: string[], payload: Record<string, unknown>) {
  for (const key of ["path", "source_path", "destination_path"] as const) {
    const normalized = normalizeChangedPath(payload[key]);
    if (normalized) candidates.push(normalized);
  }
}

function asJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function appendDeltaPart(state: StreamState, key: "textIndex" | "reasoningIndex", type: "text" | "reasoning", delta: string) {
  const index = state[key];
  if (index === null) {
    state.parts.push({ type, text: delta });
    state[key] = state.parts.length - 1;
    return;
  }

  const current = state.parts[index] as ThreadAssistantMessagePart & { text?: string };
  state.parts[index] = { ...current, type, text: `${current.text ?? ""}${delta}` };
}

function emitState(state: StreamState): ChatRunResult {
  return { content: [...state.parts] };
}

function resolveBackendThreadId(id: string | undefined) {
  return id ?? crypto.randomUUID();
}

function persistNewThreadIfNeeded(input: AdapterRunInput, deps: AdapterDeps, backendThreadId: string) {
  if (!deps.authenticated || input.unstable_threadId) return;
  persistThread(deps.getProjectId(), backendThreadId, "").catch(() => {});
}

function buildPayload(input: AdapterRunInput, deps: AdapterDeps, backendThreadId: string) {
  return {
    ...(deps.authenticated ? { project_id: deps.getProjectId() } : {}),
    ...(deps.authenticated ? { thread_id: backendThreadId } : {}),
    messages: input.messages.map((message) => ({
      role: message.role,
      content: message.content.map((part) => (part.type === "text" ? part.text : "")).join(""),
    })),
  };
}

async function openChatStream(payload: unknown, signal: AbortSignal | undefined) {
  const response = await apiRequest("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok || !response.body) throw new Error(`API error (${response.status})`);
  return response;
}

function createInitialState(): StreamState {
  return {
    parts: [],
    toolCallIndex: new Map<string, number>(),
    textIndex: null,
    reasoningIndex: null,
    usageEvent: null,
  };
}

function resolveEventType(event: StreamEvent) {
  return event.type ?? (event.delta ? "text.delta" : null);
}

function toStreamEvent(rawEvent: unknown): StreamEvent {
  return (rawEvent ?? {}) as StreamEvent;
}

function handleTextDelta(state: StreamState, event: StreamEvent): HandlerResult {
  const delta = String(event.delta ?? "");
  if (!delta) return {};
  appendDeltaPart(state, "textIndex", "text", delta);
  return { output: emitState(state) };
}

function handleReasoningDelta(state: StreamState, event: StreamEvent): HandlerResult {
  const delta = String(event.delta ?? "");
  if (!delta) return {};
  appendDeltaPart(state, "reasoningIndex", "reasoning", delta);
  return { output: emitState(state) };
}

function buildToolCallPart(event: StreamEvent): ToolCallMessagePart {
  return {
    type: "tool-call",
    toolCallId: String(event.toolCallId ?? ""),
    toolName: String(event.toolName ?? "tool"),
    args: asJsonObject(event.args) as ToolCallMessagePart["args"],
    argsText: (event.argsText as string | undefined) ?? JSON.stringify(event.args ?? {}, null, 2),
  };
}

function handleToolStart(state: StreamState, event: StreamEvent): HandlerResult {
  const part = buildToolCallPart(event);
  if (!part.toolCallId) return {};
  state.toolCallIndex.set(part.toolCallId, state.parts.length);
  state.parts.push(part);
  return { output: emitState(state) };
}

function buildToolResultPart(event: StreamEvent): ToolCallMessagePart {
  return {
    ...buildToolCallPart(event),
    result: event.result,
    isError: (event.isError as boolean | undefined) ?? false,
    artifact: event.artifact,
  };
}

function upsertToolResult(state: StreamState, updated: ToolCallMessagePart) {
  const index = state.toolCallIndex.get(updated.toolCallId);
  if (index === undefined) {
    state.toolCallIndex.set(updated.toolCallId, state.parts.length);
    state.parts.push(updated);
    return;
  }

  const existing = state.parts[index] as ToolCallMessagePart;
  state.parts[index] = {
    ...existing,
    ...updated,
    toolName: existing.toolName ?? updated.toolName,
    args: existing.args ?? updated.args,
    argsText: existing.argsText ?? updated.argsText,
  };
}

function notifyChangedPaths(deps: AdapterDeps, paths: string[]) {
  if (paths.length < 1) return deps.notifyFileChanged();
  for (const path of paths) deps.notifyFileChanged(path);
}

function handleMutatingToolEffects(deps: AdapterDeps, event: StreamEvent) {
  const toolName = String(event.toolName ?? "");
  if (!MUTATING_TOOL_NAMES.has(toolName)) return;
  notifyChangedPaths(deps, extractChangedPaths(event.result));
}

function handleToolResult(state: StreamState, deps: AdapterDeps, event: StreamEvent): HandlerResult {
  const updated = buildToolResultPart(event);
  if (!updated.toolCallId) return {};
  upsertToolResult(state, updated);
  handleMutatingToolEffects(deps, event);
  return { output: emitState(state) };
}

function handleFile(state: StreamState, event: StreamEvent): HandlerResult {
  state.parts.push({
    type: "file",
    filename: (event.filename as string | undefined) ?? undefined,
    mimeType: (event.mimeType as string | undefined) ?? "application/octet-stream",
    data: (event.dataBase64 as string | undefined) ?? "",
  });
  return { output: emitState(state) };
}

function handlePolicyStart(deps: AdapterDeps, event: StreamEvent): HandlerResult {
  deps.notifyPolicyCheck(parsePolicyCheckStartEvent(event));
  return {};
}

function handlePolicyResult(deps: AdapterDeps, event: StreamEvent): HandlerResult {
  deps.notifyPolicyCheck(parsePolicyCheckResultEvent(event));
  return {};
}

function handleUsage(state: StreamState, event: StreamEvent): HandlerResult {
  state.usageEvent = parseUsageEvent(event);
  return {};
}

function buildDoneMetadata(usageEvent: UsageEventPayload | null) {
  if (!usageEvent) return undefined;
  const custom = buildUsageCustomMetadata(usageEvent);
  return {
    steps: [{ usage: { promptTokens: usageEvent.promptTokens, completionTokens: usageEvent.completionTokens } }],
    ...(Object.keys(custom).length > 0 ? { custom } : {}),
  };
}

function buildUsageCustomMetadata(usageEvent: UsageEventPayload) {
  const custom: Record<string, string | number> = {};
  if (usageEvent.modelId) custom.modelId = usageEvent.modelId;
  if (usageEvent.modelContextWindow !== null && usageEvent.modelContextWindow !== undefined) {
    custom.modelContextWindow = usageEvent.modelContextWindow;
  }
  return custom;
}

function handleDone(state: StreamState): HandlerResult {
  return {
    done: true,
    completion: {
      content: [...state.parts],
      status: { type: "complete", reason: "stop" },
      metadata: buildDoneMetadata(state.usageEvent),
    },
  };
}

function handleStreamEvent(state: StreamState, deps: AdapterDeps, event: StreamEvent): HandlerResult {
  const type = resolveEventType(event);
  if (type === "error") throw new Error((event.message as string | undefined) ?? "stream_failed");
  if (type === "text.delta") return handleTextDelta(state, event);
  if (type === "reasoning.delta") return handleReasoningDelta(state, event);
  if (type === "tool.start") return handleToolStart(state, event);
  if (type === "tool.result") return handleToolResult(state, deps, event);
  if (type === "file") return handleFile(state, event);
  if (type === "policy.check.start") return handlePolicyStart(deps, event);
  if (type === "policy.check.result") return handlePolicyResult(deps, event);
  if (type === "usage") return handleUsage(state, event);
  if (type === "done") return handleDone(state);
  return {};
}

async function* streamChatEvents(
  response: Response,
  deps: AdapterDeps,
  state: StreamState,
): AsyncGenerator<ChatRunResult, void, unknown> {
  for await (const rawEvent of readSseJson(response)) {
    const handled = handleStreamEvent(state, deps, toStreamEvent(rawEvent));
    if (handled.output) yield handled.output;
    if (!handled.done) continue;
    if (handled.completion) yield handled.completion;
    return;
  }
}

async function* runChatAdapter(deps: AdapterDeps, input: AdapterRunInput): AsyncGenerator<ChatRunResult, void, unknown> {
  const backendThreadId = resolveBackendThreadId(input.unstable_threadId ?? undefined);
  persistNewThreadIfNeeded(input, deps, backendThreadId);
  const payload = buildPayload(input, deps, backendThreadId);
  const response = await openChatStream(payload, input.abortSignal);
  const state = createInitialState();
  yield* streamChatEvents(response, deps, state);
}

export function createChatModelAdapter(deps: AdapterDeps): ChatModelAdapter {
  return {
    run(input) {
      return runChatAdapter(deps, input);
    },
  };
}
