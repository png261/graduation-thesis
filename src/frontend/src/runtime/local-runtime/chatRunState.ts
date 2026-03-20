interface ChatRunState {
  jobId: string;
  lastSeq: number;
  text: string;
}

const CHAT_RUN_PREFIX = "da:chat-run";

function chatRunKey(projectId: string, userScope: string, threadId: string) {
  return `${CHAT_RUN_PREFIX}:${userScope}:${projectId}:${threadId}`;
}

function canUseStorage() {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return false;
  return (
    typeof window.localStorage.getItem === "function" &&
    typeof window.localStorage.setItem === "function" &&
    typeof window.localStorage.removeItem === "function"
  );
}

function readState(key: string): ChatRunState | null {
  if (!canUseStorage()) return null;
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ChatRunState;
    if (!parsed || typeof parsed.jobId !== "string" || !parsed.jobId.trim()) return null;
    const lastSeq = typeof parsed.lastSeq === "number" && parsed.lastSeq > 0 ? Math.floor(parsed.lastSeq) : 0;
    const text = typeof parsed.text === "string" ? parsed.text : "";
    return { jobId: parsed.jobId, lastSeq, text };
  } catch {
    return null;
  }
}

function writeState(key: string, state: ChatRunState) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(key, JSON.stringify(state));
}

export function getChatRunState(projectId: string, userScope: string, threadId: string): ChatRunState | null {
  return readState(chatRunKey(projectId, userScope, threadId));
}

export function setChatRunState(
  projectId: string,
  userScope: string,
  threadId: string,
  state: ChatRunState,
): void {
  writeState(chatRunKey(projectId, userScope, threadId), {
    jobId: state.jobId,
    lastSeq: Number.isFinite(state.lastSeq) && state.lastSeq > 0 ? Math.floor(state.lastSeq) : 0,
    text: typeof state.text === "string" ? state.text : "",
  });
}

export function updateChatRunSeq(
  projectId: string,
  userScope: string,
  threadId: string,
  seq: number,
): void {
  if (!Number.isFinite(seq) || seq <= 0) return;
  const current = getChatRunState(projectId, userScope, threadId);
  if (!current) return;
  if (seq <= current.lastSeq) return;
  writeState(chatRunKey(projectId, userScope, threadId), { ...current, lastSeq: Math.floor(seq) });
}

export function appendChatRunText(
  projectId: string,
  userScope: string,
  threadId: string,
  delta: string,
): void {
  if (!delta) return;
  const current = getChatRunState(projectId, userScope, threadId);
  if (!current) return;
  writeState(chatRunKey(projectId, userScope, threadId), { ...current, text: `${current.text}${delta}` });
}

export function clearChatRunState(projectId: string, userScope: string, threadId: string): void {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(chatRunKey(projectId, userScope, threadId));
}
