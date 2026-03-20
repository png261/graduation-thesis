import type {
  ChatModelAdapter,
  ThreadAssistantMessagePart,
  ToolCallMessagePart,
} from "@assistant-ui/react";

import { cancelProjectJob, persistThread } from "../../api/projects";
import { apiRequest } from "../../api/client";
import type { PolicyCheckEvent } from "../../contexts/FilesystemContext";
import { readSseJson } from "../../lib/sse";
import {
  parseBlueprintInputsSummaryEvent,
  parseBlueprintProvenanceEvent,
  parseBlueprintSuggestionsEvent,
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

type SyntheticToolName =
  | "suggest_blueprints"
  | "blueprint_inputs"
  | "blueprint_provenance";

interface AdapterDeps {
  getProjectId: () => string;
  authenticated: boolean;
  notifyFileChanged: (path?: string) => void;
  notifyPolicyCheck: (event: PolicyCheckEvent) => void;
  userScope?: string;
  notifyIncident?: (event: unknown) => void;
}

interface StreamState {
  parts: ThreadAssistantMessagePart[];
  toolCallIndex: Map<string, number>;
  textIndexByScope: Map<string, number>;
  reasoningIndexByScope: Map<string, number>;
  usageEvent: UsageEventPayload | null;
  backendThreadId: string;
  jobId: string | null;
}

type StreamEvent = Record<string, unknown> & { type?: string };

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

function collectChangedPathCandidates(payload: Record<string, unknown>): string[] {
  const candidates: string[] = [];
  const list = payload.changed_paths;
  if (Array.isArray(list)) addArrayChangedPaths(candidates, list);
  addKeyChangedPaths(candidates, payload);
  return candidates;
}

function extractChangedPaths(result: unknown): string[] {
  if (!result || typeof result !== "object") return [];
  const payload = result as Record<string, unknown>;
  return [...new Set(collectChangedPathCandidates(payload))];
}

function asJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function scopeKey(parentId: string | undefined) {
  return parentId ? `parent:${parentId}` : "root";
}

function appendDeltaPart(
  state: StreamState,
  key: "textIndexByScope" | "reasoningIndexByScope",
  type: "text" | "reasoning",
  delta: string,
  parentId: string | undefined,
) {
  const indexes = state[key];
  const targetKey = scopeKey(parentId);
  const index = indexes.get(targetKey);
  if (index === undefined) {
    state.parts.push(parentId ? { type, text: delta, parentId } : { type, text: delta });
    indexes.set(targetKey, state.parts.length - 1);
    return;
  }
  const current = state.parts[index] as ThreadAssistantMessagePart & { text?: string; parentId?: string };
  state.parts[index] = parentId
    ? { ...current, type, text: `${current.text ?? ""}${delta}`, parentId }
    : { ...current, type, text: `${current.text ?? ""}${delta}` };
}

function emitState(state: StreamState): ChatRunResult {
  return { content: [...state.parts] };
}

function resolveBackendThreadId(id: string | undefined) {
  return id ?? crypto.randomUUID();
}

function persistNewThreadIfNeeded(deps: AdapterDeps, backendThreadId: string) {
  if (!deps.authenticated) return;
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

function createInitialState(backendThreadId: string): StreamState {
  return {
    parts: [],
    toolCallIndex: new Map<string, number>(),
    textIndexByScope: new Map<string, number>(),
    reasoningIndexByScope: new Map<string, number>(),
    usageEvent: null,
    backendThreadId,
    jobId: null,
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
  appendDeltaPart(
    state,
    "textIndexByScope",
    "text",
    delta,
    typeof event.parentId === "string" ? event.parentId : undefined,
  );
  return { output: emitState(state) };
}

function handleReasoningDelta(state: StreamState, event: StreamEvent): HandlerResult {
  const delta = String(event.delta ?? "");
  if (!delta) return {};
  appendDeltaPart(
    state,
    "reasoningIndexByScope",
    "reasoning",
    delta,
    typeof event.parentId === "string" ? event.parentId : undefined,
  );
  return { output: emitState(state) };
}

function handleSource(state: StreamState, event: StreamEvent): HandlerResult {
  state.parts.push({
    type: "source",
    sourceType: "url",
    id: String(event.id ?? ""),
    title: String(event.title ?? ""),
    url: String(event.url ?? ""),
    parentId: typeof event.parentId === "string" ? event.parentId : undefined,
  } as ThreadAssistantMessagePart);
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

function upsertToolCall(state: StreamState, updated: ToolCallMessagePart) {
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
    args: updated.args,
    argsText: updated.argsText,
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

function handleChatJob(state: StreamState, event: StreamEvent): HandlerResult {
  state.jobId = typeof event.jobId === "string" ? event.jobId : null;
  return {};
}

function buildSyntheticToolResult(
  state: StreamState,
  deps: AdapterDeps,
  toolName: SyntheticToolName,
  event: StreamEvent,
  result: unknown,
): ToolCallMessagePart {
  const args = {
    projectId: deps.getProjectId(),
    threadId: state.backendThreadId,
    kind: typeof event.kind === "string" ? event.kind : undefined,
  };
  return {
    type: "tool-call",
    toolCallId: `${toolName}:${String(event.kind ?? "default")}`,
    toolName,
    args: args as ToolCallMessagePart["args"],
    argsText: JSON.stringify(args, null, 2),
    result,
    isError: false,
  };
}

function buildSyntheticToolCallArgs(
  state: StreamState,
  deps: AdapterDeps,
  event: StreamEvent,
  extraArgs: Record<string, unknown> = {},
) {
  return {
    projectId: deps.getProjectId(),
    threadId: state.backendThreadId,
    kind: typeof event.kind === "string" ? event.kind : undefined,
    ...extraArgs,
  };
}

function buildSyntheticHumanToolCall(
  state: StreamState,
  deps: AdapterDeps,
  toolName: SyntheticToolName,
  event: StreamEvent,
  extraArgs: Record<string, unknown> = {},
): ToolCallMessagePart {
  const args = buildSyntheticToolCallArgs(state, deps, event, extraArgs);
  return {
    type: "tool-call",
    toolCallId: `${toolName}:${String(event.kind ?? "default")}`,
    toolName,
    args: args as ToolCallMessagePart["args"],
    argsText: JSON.stringify(args, null, 2),
    interrupt: {
      type: "human",
      payload: { toolName, kind: typeof event.kind === "string" ? event.kind : undefined },
    },
  };
}

function handleBlueprintSuggestions(state: StreamState, deps: AdapterDeps, event: StreamEvent): HandlerResult {
  const parsed = parseBlueprintSuggestionsEvent(event);
  const updated = buildSyntheticHumanToolCall(
    state,
    deps,
    "suggest_blueprints",
    event,
    { suggestions: parsed.suggestions },
  );
  upsertToolCall(state, updated);
  return { output: emitState(state) };
}

function handleBlueprintInputs(state: StreamState, deps: AdapterDeps, event: StreamEvent): HandlerResult {
  const updated = buildSyntheticToolResult(
    state,
    deps,
    "blueprint_inputs",
    event,
    parseBlueprintInputsSummaryEvent(event),
  );
  upsertToolResult(state, updated);
  return { output: emitState(state) };
}

function handleBlueprintProvenance(state: StreamState, deps: AdapterDeps, event: StreamEvent): HandlerResult {
  const updated = buildSyntheticToolResult(
    state,
    deps,
    "blueprint_provenance",
    event,
    parseBlueprintProvenanceEvent(event),
  );
  upsertToolResult(state, updated);
  return { output: emitState(state) };
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

function isPendingHumanToolCall(part: ThreadAssistantMessagePart) {
  return part.type === "tool-call" && part.interrupt?.type === "human" && part.result === undefined;
}

function buildCompletion(state: StreamState): ChatRunResult {
  if (state.parts.some(isPendingHumanToolCall)) {
    return {
      content: [...state.parts],
      status: { type: "requires-action", reason: "tool-calls" },
      metadata: buildDoneMetadata(state.usageEvent),
    };
  }
  return {
    content: [...state.parts],
    status: { type: "complete", reason: "stop" },
    metadata: buildDoneMetadata(state.usageEvent),
  };
}

function handleDone(state: StreamState): HandlerResult {
  return { done: true, completion: buildCompletion(state) };
}

function handleStreamEvent(state: StreamState, deps: AdapterDeps, event: StreamEvent): HandlerResult {
  const type = resolveEventType(event);
  if (type === "error") throw new Error((event.message as string | undefined) ?? "stream_failed");
  if (type === "chat.job") return handleChatJob(state, event);
  if (type === "source") return handleSource(state, event);
  if (type === "text.delta") return handleTextDelta(state, event);
  if (type === "reasoning.delta") return handleReasoningDelta(state, event);
  if (type === "tool.start") return handleToolStart(state, event);
  if (type === "tool.result") return handleToolResult(state, deps, event);
  if (type === "file") return handleFile(state, event);
  if (type === "blueprint.suggestions") return handleBlueprintSuggestions(state, deps, event);
  if (type === "blueprint.inputs.summary") return handleBlueprintInputs(state, deps, event);
  if (type === "blueprint.provenance") return handleBlueprintProvenance(state, deps, event);
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
  for await (const rawEvent of readSseJson<StreamEvent>(response)) {
    const handled = handleStreamEvent(state, deps, toStreamEvent(rawEvent));
    if (handled.output) yield handled.output;
    if (!handled.done) continue;
    if (handled.completion) yield handled.completion;
    return;
  }
  yield buildCompletion(state);
}

function isCancelledError(error: unknown) {
  return error instanceof Error && error.message === "Request was cancelled";
}

function isDetachAbort(signal: AbortSignal | undefined) {
  const reason = signal?.reason as { detach?: boolean; name?: string } | undefined;
  return Boolean(signal?.aborted && reason?.name === "AbortError" && reason.detach === true);
}

function shouldTreatAbortAsUserStop(signal: AbortSignal | undefined) {
  if (!signal?.aborted || isDetachAbort(signal)) return false;
  const reason = signal.reason as { name?: string } | undefined;
  return !reason || reason.name === "AbortError";
}

async function cancelActiveJob(state: StreamState, deps: AdapterDeps) {
  if (!deps.authenticated || !state.jobId) return;
  try {
    await cancelProjectJob(deps.getProjectId(), state.jobId);
  } catch {
    return;
  }
}

async function* runChatAdapter(deps: AdapterDeps, input: AdapterRunInput): AsyncGenerator<ChatRunResult, void, unknown> {
  const backendThreadId = resolveBackendThreadId(input.unstable_threadId ?? undefined);
  persistNewThreadIfNeeded(deps, backendThreadId);
  const state = createInitialState(backendThreadId);

  try {
    const payload = buildPayload(input, deps, backendThreadId);
    const response = await openChatStream(payload, input.abortSignal);
    yield* streamChatEvents(response, deps, state);
  } catch (error) {
    if (!isCancelledError(error) || !input.abortSignal?.aborted) throw error;
    if (!shouldTreatAbortAsUserStop(input.abortSignal)) return;
    await cancelActiveJob(state, deps);
    yield buildCompletion(state);
  }
}

export function createChatModelAdapter(deps: AdapterDeps): ChatModelAdapter {
  return {
    run(input) {
      return runChatAdapter(deps, input);
    },
  };
}
