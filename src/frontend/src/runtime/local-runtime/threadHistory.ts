import type {
  ExportedMessageRepositoryItem,
  ThreadHistoryAdapter,
  ThreadMessage,
} from "@assistant-ui/react";

const THREAD_HISTORY_PREFIX = "da:thread-history";

type StoredThreadHistory = {
  headId?: string | null;
  messages: ExportedMessageRepositoryItem[];
  unstable_resume?: boolean;
};

const inMemoryHistory = new Map<string, StoredThreadHistory>();

export function getThreadHistoryKey(projectId: string, threadId: string, userScope: string) {
  return `${THREAD_HISTORY_PREFIX}:${userScope}:${projectId}:${threadId}`;
}

function coerceMessageDate(message: ThreadMessage): ThreadMessage {
  const rawCreatedAt = (message as { createdAt: unknown }).createdAt;
  const createdAt = rawCreatedAt instanceof Date ? rawCreatedAt : new Date(String(rawCreatedAt));
  return { ...message, createdAt };
}

function readThreadHistoryFromStorage(key: string): StoredThreadHistory {
  if (typeof window === "undefined") return { messages: [] };
  const raw = window.localStorage.getItem(key);
  if (!raw) return { messages: [] };

  try {
    const parsed = JSON.parse(raw) as StoredThreadHistory;
    const messages = Array.isArray(parsed.messages)
      ? parsed.messages.map((item) => ({
          ...item,
          message: coerceMessageDate(item.message as ThreadMessage),
        }))
      : [];
    return {
      headId: parsed.headId ?? null,
      messages,
      ...(parsed.unstable_resume ? { unstable_resume: true } : {}),
    };
  } catch {
    return { messages: [] };
  }
}

function writeThreadHistoryToStorage(key: string, history: StoredThreadHistory) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(history));
}

function readThreadHistoryFromMemory(key: string): StoredThreadHistory {
  return inMemoryHistory.get(key) ?? { messages: [] };
}

function writeThreadHistoryToMemory(key: string, history: StoredThreadHistory) {
  inMemoryHistory.set(key, history);
}

export function removeThreadHistoryFromStorage(projectId: string, threadId: string, userScope: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(getThreadHistoryKey(projectId, threadId, userScope));
}

export function removeThreadHistoryFromMemory(projectId: string, threadId: string, userScope: string) {
  inMemoryHistory.delete(getThreadHistoryKey(projectId, threadId, userScope));
}

export function makeThreadSummaryTitle(messages: readonly ThreadMessage[]) {
  const firstUser = messages.find((message) => message.role === "user");
  if (!firstUser) return "New thread";

  const text = firstUser.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/[#`>*_[\]()]/g, "")
    .trim();

  if (!text) return "New thread";

  const words = text.split(" ").slice(0, 8).join(" ");
  if (words.length <= 64) return words;
  return `${words.slice(0, 61).trimEnd()}...`;
}

export function createBrowserThreadHistoryAdapter(
  projectId: string,
  userScope: string,
  getThreadId: () => string | undefined,
): ThreadHistoryAdapter {
  return {
    load: async () => {
      const threadId = getThreadId();
      if (!threadId) return { messages: [] };
      return readThreadHistoryFromStorage(getThreadHistoryKey(projectId, threadId, userScope));
    },
    append: async (item) => {
      const threadId = getThreadId();
      if (!threadId) return;

      const key = getThreadHistoryKey(projectId, threadId, userScope);
      const previous = readThreadHistoryFromStorage(key);
      const deduped = previous.messages.filter((entry) => entry.message.id !== item.message.id);
      deduped.push({
        ...item,
        message: coerceMessageDate(item.message as ThreadMessage),
      });

      writeThreadHistoryToStorage(key, {
        headId: item.message.id,
        messages: deduped,
      });
    },
  };
}

export function createMemoryThreadHistoryAdapter(
  projectId: string,
  userScope: string,
  getThreadId: () => string | undefined,
): ThreadHistoryAdapter {
  return {
    load: async () => {
      const threadId = getThreadId();
      if (!threadId) return { messages: [] };
      return readThreadHistoryFromMemory(getThreadHistoryKey(projectId, threadId, userScope));
    },
    append: async (item) => {
      const threadId = getThreadId();
      if (!threadId) return;

      const key = getThreadHistoryKey(projectId, threadId, userScope);
      const previous = readThreadHistoryFromMemory(key);
      const deduped = previous.messages.filter((entry) => entry.message.id !== item.message.id);
      deduped.push({
        ...item,
        message: coerceMessageDate(item.message as ThreadMessage),
      });

      writeThreadHistoryToMemory(key, {
        headId: item.message.id,
        messages: deduped,
      });
    },
  };
}
