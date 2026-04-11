import type {
  ChatModelAdapter,
  ThreadAssistantMessagePart,
  ToolCallMessagePart,
} from "@assistant-ui/react";

import { persistThread } from "../../api/projects";
import { apiJson, apiRequest } from "../../api/client";
import { parseEvidenceBundleText, type EvidenceBundlePayload } from "../../components/assistant-ui/evidence-bundle";
import type { FilesystemSyncEvent, PolicyCheckEvent } from "../../contexts/FilesystemContext";
import { readSseJson } from "../../lib/sse";
import {
  dispatchAttachmentError,
  serializeChatAttachments,
  type ChatAttachmentPayload,
} from "./documentAttachmentAdapter";
import {
  parseEvidenceBundleEvent,
  parsePolicyCheckResultEvent,
  parsePolicyCheckStartEvent,
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
const FOLLOWABLE_FILE_TOOL_NAMES = new Set(["write_file", "edit_file"]);
const FILE_CONTENT_KEYS = [
  "content",
  "contents",
  "file_content",
  "fileContent",
  "new_content",
  "newContent",
  "updated_content",
  "updatedContent",
];

type SyntheticToolName = "evidence_bundle";

interface AdapterDeps {
  getProjectId: () => string;
  authenticated: boolean;
  notifyFileChanged: (event?: FilesystemSyncEvent) => void;
  notifyPolicyCheck: (event: PolicyCheckEvent) => void;
  userScope?: string;
  notifyIncident?: (event: unknown) => void;
}

interface StreamState {
  parts: ThreadAssistantMessagePart[];
  toolCallIndex: Map<string, number>;
  textIndexByScope: Map<string, number>;
  reasoningIndexByScope: Map<string, number>;
  backendThreadId: string;
  jobId: string | null;
}

type StreamEvent = Record<string, unknown> & { type?: string };
type ToolArtifactMetadata = {
  schemaVersion?: number;
  sourceTool?: string;
  severity?: string;
  fixClass?: string;
  diagnostic?: Record<string, unknown>;
};
type StructuredToolCallMessagePart = ToolCallMessagePart & ToolArtifactMetadata;

type AdapterRunInput = Parameters<ChatModelAdapter["run"]>[0];
type InferRunResult<T> = T extends Promise<infer R>
  ? R
  : T extends AsyncGenerator<infer R, void, unknown>
    ? R
    : never;
type ChatRunResult = InferRunResult<ReturnType<ChatModelAdapter["run"]>>;

type HandlerResult = { output?: ChatRunResult; done?: boolean; completion?: ChatRunResult };

type ChatPayloadMessage = {
  role: string;
  content: string;
  attachments?: ChatAttachmentPayload[];
};

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
  for (const key of [
    "path",
    "file",
    "filename",
    "filepath",
    "file_path",
    "filePath",
    "target",
    "target_path",
    "targetPath",
    "source_path",
    "destination_path",
  ] as const) {
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

function firstChangedPath(value: unknown) {
  return extractChangedPaths(value)[0];
}

function extractPreviewContent(args: unknown): string | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) return undefined;
  const payload = args as Record<string, unknown>;
  for (const key of FILE_CONTENT_KEYS) {
    const value = readStringValue(payload[key]);
    if (value) return value;
  }
  return undefined;
}

function buildSyncEvent(event: StreamEvent, behavior: "refresh" | "follow", source: "tool.start" | "tool.result") {
  const path = firstChangedPath(source === "tool.start" ? event.args : event.result) ?? firstChangedPath(event.args);
  if (!path) return undefined;
  const syncEvent: FilesystemSyncEvent = { path, behavior, source };
  if (source === "tool.start") syncEvent.previewContent = extractPreviewContent(event.args);
  return syncEvent;
}

function asJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function readStringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readToolArtifactMetadata(event: StreamEvent): ToolArtifactMetadata {
  const diagnostic = asJsonObject(event.diagnostic);
  return {
    schemaVersion: typeof event.schemaVersion === "number" ? event.schemaVersion : undefined,
    sourceTool: readStringValue(event.sourceTool),
    severity: readStringValue(event.severity),
    fixClass: readStringValue(event.fixClass),
    diagnostic: Object.keys(diagnostic).length > 0 ? diagnostic : undefined,
  };
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

function textParts(parts: readonly { type: string; text?: string }[]) {
  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("");
}

function messagePayload(message: AdapterRunInput["messages"][number]): ChatPayloadMessage {
  const payload: ChatPayloadMessage = {
    role: message.role,
    content: textParts(message.content),
  };
  if (message.role !== "user" || !message.attachments?.length) return payload;
  let attachments: ChatAttachmentPayload[];
  try {
    attachments = serializeChatAttachments(message.attachments);
  } catch (error) {
    dispatchAttachmentError(error instanceof Error ? error.message : "Unable to attach file");
    throw error;
  }
  if (attachments.length > 0) payload.attachments = attachments;
  return payload;
}

function buildPayload(input: AdapterRunInput, deps: AdapterDeps, backendThreadId: string) {
  return {
    ...(deps.authenticated ? { project_id: deps.getProjectId() } : {}),
    ...(deps.authenticated ? { thread_id: backendThreadId } : {}),
    messages: input.messages.map(messagePayload),
  };
}

async function openChatStream(payload: unknown, signal: AbortSignal | undefined) {
  const response = await apiRequest("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) {
    await apiJson<unknown>(response);
  }
  if (!response.body) throw new Error(`API error (${response.status})`);
  return response;
}

function createInitialState(backendThreadId: string): StreamState {
  return {
    parts: [],
    toolCallIndex: new Map<string, number>(),
    textIndexByScope: new Map<string, number>(),
    reasoningIndexByScope: new Map<string, number>(),
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

function buildToolCallPart(event: StreamEvent): StructuredToolCallMessagePart {
  return {
    type: "tool-call",
    toolCallId: String(event.toolCallId ?? ""),
    toolName: String(event.toolName ?? "tool"),
    args: asJsonObject(event.args) as ToolCallMessagePart["args"],
    argsText: (event.argsText as string | undefined) ?? JSON.stringify(event.args ?? {}, null, 2),
    ...readToolArtifactMetadata(event),
  };
}

function hasMeaningfulToolName(value: string | undefined) {
  return Boolean(value && value.trim() && value !== "tool");
}

function hasMeaningfulArgs(value: unknown) {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

function hasMeaningfulArgsText(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed !== "" && trimmed !== "{}" && trimmed !== "null";
}

function mergeToolCallPart(
  existing: StructuredToolCallMessagePart,
  updated: StructuredToolCallMessagePart,
): StructuredToolCallMessagePart {
  return {
    ...existing,
    ...updated,
    toolName: hasMeaningfulToolName(updated.toolName) ? updated.toolName : existing.toolName ?? updated.toolName,
    args: hasMeaningfulArgs(updated.args) ? updated.args : existing.args ?? updated.args,
    argsText: hasMeaningfulArgsText(updated.argsText)
      ? updated.argsText
      : existing.argsText ?? updated.argsText,
  };
}

function handleToolStart(state: StreamState, deps: AdapterDeps, event: StreamEvent): HandlerResult {
  const part = buildToolCallPart(event);
  if (!part.toolCallId) return {};
  const existingIndex = state.toolCallIndex.get(part.toolCallId);
  if (existingIndex !== undefined) {
    const existing = state.parts[existingIndex] as StructuredToolCallMessagePart;
    state.parts[existingIndex] = mergeToolCallPart(existing, part);
    handleMutatingToolStartEffects(deps, event);
    return { output: emitState(state) };
  }
  state.toolCallIndex.set(part.toolCallId, state.parts.length);
  state.parts.push(part);
  handleMutatingToolStartEffects(deps, event);
  return { output: emitState(state) };
}

function buildToolResultPart(event: StreamEvent): StructuredToolCallMessagePart {
  return {
    ...buildToolCallPart(event),
    result: event.result,
    isError: (event.isError as boolean | undefined) ?? false,
    artifact: event.artifact,
  };
}

function upsertToolResult(state: StreamState, updated: StructuredToolCallMessagePart) {
  const index = state.toolCallIndex.get(updated.toolCallId);
  if (index === undefined) {
    state.toolCallIndex.set(updated.toolCallId, state.parts.length);
    state.parts.push(updated);
    return;
  }

  const existing = state.parts[index] as StructuredToolCallMessagePart;
  state.parts[index] = mergeToolCallPart(existing, updated);
}

function notifyChangedPaths(deps: AdapterDeps, paths: string[]) {
  if (paths.length < 1) return deps.notifyFileChanged();
  for (const path of paths) deps.notifyFileChanged({ path, behavior: "refresh", source: "tool.result" });
}

function notifyFilesystemEvent(deps: AdapterDeps, event: FilesystemSyncEvent | undefined) {
  deps.notifyFileChanged(event);
}

function handleMutatingToolStartEffects(deps: AdapterDeps, event: StreamEvent) {
  const toolName = String(event.toolName ?? "");
  if (!FOLLOWABLE_FILE_TOOL_NAMES.has(toolName)) return;
  notifyFilesystemEvent(deps, buildSyncEvent(event, "follow", "tool.start"));
}

function handleMutatingToolEffects(deps: AdapterDeps, event: StreamEvent) {
  const toolName = String(event.toolName ?? "");
  if (!MUTATING_TOOL_NAMES.has(toolName)) return;
  if (FOLLOWABLE_FILE_TOOL_NAMES.has(toolName)) {
    notifyFilesystemEvent(deps, buildSyncEvent(event, "follow", "tool.result"));
    return;
  }
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

function pruneEvidenceBundleTextParts(state: StreamState) {
  const nextParts: ThreadAssistantMessagePart[] = [];
  const nextToolCallIndex = new Map<string, number>();
  for (const part of state.parts) {
    if (part.type === "text" && typeof part.text === "string" && parseEvidenceBundleText(part.text)) {
      continue;
    }
    nextParts.push(part);
    if (part.type === "tool-call" && part.toolCallId) {
      nextToolCallIndex.set(part.toolCallId, nextParts.length - 1);
    }
  }
  state.parts = nextParts;
  state.toolCallIndex = nextToolCallIndex;
  state.textIndexByScope = new Map();
}

function handleEvidenceBundle(state: StreamState, deps: AdapterDeps, event: StreamEvent): HandlerResult {
  const bundle = parseEvidenceBundleEvent(event);
  pruneEvidenceBundleTextParts(state);
  const updated = buildSyntheticToolResult(
    state,
    deps,
    "evidence_bundle",
    event,
    bundle as unknown as EvidenceBundlePayload,
  );
  upsertToolResult(state, updated);
  return { output: emitState(state) };
}

function isPendingHumanToolCall(part: ThreadAssistantMessagePart) {
  return part.type === "tool-call" && part.interrupt?.type === "human" && part.result === undefined;
}

function buildCompletion(state: StreamState): ChatRunResult {
  if (state.parts.some(isPendingHumanToolCall)) {
    return {
      content: [...state.parts],
      status: { type: "requires-action", reason: "tool-calls" },
    };
  }
  return {
    content: [...state.parts],
    status: { type: "complete", reason: "stop" },
  };
}

function appendAssistantText(state: StreamState, text: string) {
  const value = text.trim();
  if (!value) return;
  state.parts.push({ type: "text", text: value });
}

function buildErrorCompletion(state: StreamState, message: string): ChatRunResult {
  appendAssistantText(state, message);
  return buildCompletion(state);
}

function streamErrorMessage(event: StreamEvent) {
  const message = readStringValue(event.message);
  if (message === "stream_failed") {
    return "The chat stream failed before a response arrived. Please retry.";
  }
  return message ?? "The chat request failed before a response arrived. Please retry.";
}

function handleDone(state: StreamState): HandlerResult {
  return { done: true, completion: buildCompletion(state) };
}

function handleStreamEvent(state: StreamState, deps: AdapterDeps, event: StreamEvent): HandlerResult {
  const type = resolveEventType(event);
  if (type === "error") {
    return { done: true, completion: buildErrorCompletion(state, streamErrorMessage(event)) };
  }
  if (type === "chat.job") return handleChatJob(state, event);
  if (type === "source") return handleSource(state, event);
  if (type === "text.delta") return handleTextDelta(state, event);
  if (type === "reasoning.delta") return handleReasoningDelta(state, event);
  if (type === "tool.start") return handleToolStart(state, deps, event);
  if (type === "tool.result") return handleToolResult(state, deps, event);
  if (type === "file") return handleFile(state, event);
  if (type === "evidence.bundle") return handleEvidenceBundle(state, deps, event);
  if (type === "policy.check.start") return handlePolicyStart(deps, event);
  if (type === "policy.check.result") return handlePolicyResult(deps, event);
  if (type === "done") return handleDone(state);
  return {};
}

async function* streamChatEvents(
  response: Response,
  deps: AdapterDeps,
  state: StreamState,
): AsyncGenerator<ChatRunResult, void, unknown> {
  let sawEvent = false;
  for await (const rawEvent of readSseJson<StreamEvent>(response)) {
    sawEvent = true;
    const handled = handleStreamEvent(state, deps, toStreamEvent(rawEvent));
    if (handled.output) yield handled.output;
    if (!handled.done) continue;
    if (handled.completion) yield handled.completion;
    return;
  }
  if (state.parts.length > 0) {
    yield buildCompletion(state);
    return;
  }
  yield buildErrorCompletion(
    state,
    sawEvent
      ? "The chat stream ended without any response content. Please retry."
      : "The chat stream returned no events. Please retry.",
  );
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

async function cancelActiveJob(_state: StreamState, _deps: AdapterDeps) {}

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
