import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, FC, PropsWithChildren, SetStateAction } from "react";

import { RuntimeAdapterProvider, useAuiState } from "@assistant-ui/react";
import type { ThreadMessage, unstable_RemoteThreadListAdapter } from "@assistant-ui/react";

import { deleteThreadApi, fetchThreads, persistThread, type Thread } from "../../api/projects";
import {
  createBrowserThreadHistoryAdapter,
  createMemoryThreadHistoryAdapter,
  makeThreadSummaryTitle,
  removeThreadHistoryFromMemory,
  removeThreadHistoryFromStorage,
} from "./threadHistory";

const guestThreadStore = new Map<string, Thread[]>();

interface AdapterContext {
  projectId: string;
  authenticated: boolean;
  userScope: string;
  guestThreads: Thread[];
  setGuestThreads: Dispatch<SetStateAction<Thread[]>>;
}

export function getGuestThreadsSnapshot(projectId: string): Array<{ id: string; title: string }> {
  return readGuestThreads(projectId).map((thread) => ({ id: thread.id, title: thread.title }));
}

function readGuestThreads(projectId: string) {
  return guestThreadStore.get(projectId) ?? [];
}

function writeGuestThreads(projectId: string, threads: Thread[]) {
  guestThreadStore.set(projectId, threads);
}

function updateGuestThreads(
  projectId: string,
  setGuestThreads: Dispatch<SetStateAction<Thread[]>>,
  update: (threads: Thread[]) => Thread[],
) {
  setGuestThreads((previous) => {
    const next = update(previous);
    writeGuestThreads(projectId, next);
    return next;
  });
}

function mapThreadSummary(thread: Thread) {
  return {
    status: "regular" as const,
    remoteId: thread.id,
    title: thread.title || undefined,
    externalId: undefined,
  };
}

function ensureGuestThread(threads: Thread[], threadId: string) {
  if (threads.some((thread) => thread.id === threadId)) return threads;
  return [...threads, { id: threadId, title: "", createdAt: new Date().toISOString() }];
}

function renameGuestThread(threads: Thread[], remoteId: string, title: string) {
  return threads.map((thread) => (thread.id === remoteId ? { ...thread, title } : thread));
}

function removeGuestThread(threads: Thread[], remoteId: string) {
  return threads.filter((thread) => thread.id !== remoteId);
}

function setGuestThreadTitle(threads: Thread[], remoteId: string, title: string) {
  if (!threads.some((thread) => thread.id === remoteId)) {
    return [...threads, { id: remoteId, title, createdAt: new Date().toISOString() }];
  }
  return renameGuestThread(threads, remoteId, title);
}

function createTitleStream(title: string) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ type: "part-start", path: [0], part: { type: "text" } });
      controller.enqueue({ type: "text-delta", path: [0], textDelta: title });
      controller.enqueue({
        type: "message-finish",
        path: [],
        finishReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0 },
      });
      controller.close();
    },
  });
}

const ThreadPersistenceProvider: FC<PropsWithChildren<{ projectId: string; authenticated: boolean; userScope: string }>> = ({
  projectId,
  authenticated,
  userScope,
  children,
}) => {
  const remoteThreadId = useAuiState(({ threadListItem }) => threadListItem.remoteId);
  const threadIdRef = useRef<string | undefined>(remoteThreadId ?? undefined);

  useEffect(() => {
    threadIdRef.current = remoteThreadId ?? undefined;
  }, [remoteThreadId]);

  const adapters = useMemo(
    () => ({
      history: authenticated
        ? createBrowserThreadHistoryAdapter(projectId, userScope, () => threadIdRef.current)
        : createMemoryThreadHistoryAdapter(projectId, userScope, () => threadIdRef.current),
    }),
    [authenticated, projectId, userScope],
  );

  return <RuntimeAdapterProvider adapters={adapters}>{children}</RuntimeAdapterProvider>;
};

function useGuestThreads(projectId: string, authenticated: boolean) {
  const [guestThreads, setGuestThreads] = useState<Thread[]>(() => readGuestThreads(projectId));

  useEffect(() => {
    if (authenticated) return;
    setGuestThreads(readGuestThreads(projectId));
  }, [authenticated, projectId]);

  return { guestThreads, setGuestThreads };
}

function createListHandler(context: AdapterContext) {
  return async () => {
    const threads = context.authenticated ? await fetchThreads(context.projectId) : context.guestThreads;
    return { threads: threads.map(mapThreadSummary) };
  };
}

function createInitializeHandler(context: AdapterContext) {
  return async (threadId: string) => {
    if (context.authenticated) {
      await persistThread(context.projectId, threadId, "");
      return { remoteId: threadId, externalId: undefined };
    }
    updateGuestThreads(context.projectId, context.setGuestThreads, (threads) => ensureGuestThread(threads, threadId));
    return { remoteId: threadId, externalId: undefined };
  };
}

function createRenameHandler(context: AdapterContext) {
  return async (remoteId: string, newTitle: string) => {
    const title = newTitle.trim();
    if (context.authenticated) return persistThread(context.projectId, remoteId, title);
    updateGuestThreads(context.projectId, context.setGuestThreads, (threads) => renameGuestThread(threads, remoteId, title));
  };
}

function createDeleteHandler(context: AdapterContext) {
  return async (remoteId: string) => {
    if (context.authenticated) {
      await deleteThreadApi(context.projectId, remoteId);
      removeThreadHistoryFromStorage(context.projectId, remoteId, context.userScope);
      return;
    }

    updateGuestThreads(context.projectId, context.setGuestThreads, (threads) => removeGuestThread(threads, remoteId));
    removeThreadHistoryFromMemory(context.projectId, remoteId, context.userScope);
  };
}

function persistGeneratedTitle(context: AdapterContext, remoteId: string, title: string) {
  if (context.authenticated) {
    persistThread(context.projectId, remoteId, title).catch(() => {});
    return;
  }

  updateGuestThreads(context.projectId, context.setGuestThreads, (threads) => setGuestThreadTitle(threads, remoteId, title));
}

function createGenerateTitleHandler(context: AdapterContext) {
  return async (remoteId: string, messages: readonly ThreadMessage[]) => {
    const title = makeThreadSummaryTitle(messages);
    persistGeneratedTitle(context, remoteId, title);
    return createTitleStream(title);
  };
}

function createFetchHandler(context: AdapterContext) {
  return async (threadId: string) => {
    const threads = context.authenticated ? await fetchThreads(context.projectId) : context.guestThreads;
    const thread = threads.find((item) => item.id === threadId);
    if (!thread) throw new Error("Thread not found");
    return mapThreadSummary(thread);
  };
}

function createProviderRenderer(context: AdapterContext) {
  return ({ children }: PropsWithChildren) => (
    <ThreadPersistenceProvider
      projectId={context.projectId}
      authenticated={context.authenticated}
      userScope={context.userScope}
    >
      {children}
    </ThreadPersistenceProvider>
  );
}

function createThreadListAdapter(context: AdapterContext): unstable_RemoteThreadListAdapter {
  return {
    list: createListHandler(context),
    initialize: createInitializeHandler(context),
    rename: createRenameHandler(context),
    archive: async () => {},
    unarchive: async () => {},
    delete: createDeleteHandler(context),
    generateTitle: createGenerateTitleHandler(context),
    fetch: createFetchHandler(context),
    unstable_Provider: createProviderRenderer(context),
  };
}

interface AdapterOptions {
  authenticated: boolean;
  userScope: string;
}

export function useProjectThreadListAdapter(projectId: string, options: AdapterOptions): unstable_RemoteThreadListAdapter {
  const { authenticated, userScope } = options;
  const { guestThreads, setGuestThreads } = useGuestThreads(projectId, authenticated);

  return useMemo(() => {
    const context: AdapterContext = { authenticated, userScope, projectId, guestThreads, setGuestThreads };
    return createThreadListAdapter(context);
  }, [authenticated, guestThreads, projectId, setGuestThreads, userScope]);
}
