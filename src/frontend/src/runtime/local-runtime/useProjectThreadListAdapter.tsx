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

interface AdapterContext {
  projectId: string;
  authenticated: boolean;
  userScope: string;
}

function mapThreadSummary(thread: Thread) {
  return {
    status: "regular" as const,
    remoteId: thread.id,
    title: thread.title || undefined,
    externalId: undefined,
  };
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

function createListHandler(context: AdapterContext) {
  return async () => {
    const threads = await fetchThreads(context.projectId);
    return { threads: threads.map(mapThreadSummary) };
  };
}

function createInitializeHandler(context: AdapterContext) {
  return async (threadId: string) => {
    if (context.authenticated) {
      await persistThread(context.projectId, threadId, "");
      return { remoteId: threadId, externalId: undefined };
    }
  };
}

function createRenameHandler(context: AdapterContext) {
  return async (remoteId: string, newTitle: string) => {
    const title = newTitle.trim();
    if (context.authenticated) return persistThread(context.projectId, remoteId, title);
  };
}

function createDeleteHandler(context: AdapterContext) {
  return async (remoteId: string) => {
    if (context.authenticated) {
      await deleteThreadApi(context.projectId, remoteId);
      removeThreadHistoryFromStorage(context.projectId, remoteId, context.userScope);
      return;
    }
  };
}

function persistGeneratedTitle(context: AdapterContext, remoteId: string, title: string) {
  if (context.authenticated) {
    persistThread(context.projectId, remoteId, title).catch(() => {});
    return;
  }
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
    const threads = await fetchThreads(context.projectId);
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

  return useMemo(() => {
    const context: AdapterContext = { authenticated, userScope, projectId};
    return createThreadListAdapter(context);
  }, [authenticated, projectId, userScope]);
}
