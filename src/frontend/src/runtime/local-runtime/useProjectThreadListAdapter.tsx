import { useEffect, useMemo, useRef, useState } from "react";
import type { FC, PropsWithChildren } from "react";

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

export function getGuestThreadsSnapshot(projectId: string): Array<{ id: string; title: string }> {
  return (guestThreadStore.get(projectId) ?? []).map((thread) => ({
    id: thread.id,
    title: thread.title,
  }));
}

const ThreadPersistenceProvider: FC<
  PropsWithChildren<{
    projectId: string;
    authenticated: boolean;
    userScope: string;
  }>
> = ({
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
    [projectId, authenticated, userScope],
  );

  return <RuntimeAdapterProvider adapters={adapters}>{children}</RuntimeAdapterProvider>;
};

interface AdapterOptions {
  authenticated: boolean;
  userScope: string;
}

export function useProjectThreadListAdapter(
  projectId: string,
  options: AdapterOptions,
): unstable_RemoteThreadListAdapter {
  const { authenticated, userScope } = options;
  const [guestThreads, setGuestThreads] = useState<Thread[]>(() => guestThreadStore.get(projectId) ?? []);

  useEffect(() => {
    if (authenticated) return;
    setGuestThreads(guestThreadStore.get(projectId) ?? []);
  }, [authenticated, projectId]);

  return useMemo(
    () => ({
      list: async () => {
        const threads = authenticated ? await fetchThreads(projectId) : guestThreads;
        return {
          threads: threads.map((thread) => ({
            status: "regular" as const,
            remoteId: thread.id,
            title: thread.title || undefined,
            externalId: undefined,
          })),
        };
      },
      initialize: async (threadId: string) => {
        if (authenticated) {
          await persistThread(projectId, threadId, "");
        } else {
          setGuestThreads((prev) => {
            const next = prev.some((thread) => thread.id === threadId)
              ? prev
              : [...prev, { id: threadId, title: "", createdAt: new Date().toISOString() }];
            guestThreadStore.set(projectId, next);
            return next;
          });
        }
        return { remoteId: threadId, externalId: undefined };
      },
      rename: async (remoteId: string, newTitle: string) => {
        if (authenticated) {
          await persistThread(projectId, remoteId, newTitle.trim());
          return;
        }
        setGuestThreads((prev) => {
          const next = prev.map((thread) =>
            thread.id === remoteId ? { ...thread, title: newTitle.trim() } : thread,
          );
          guestThreadStore.set(projectId, next);
          return next;
        });
      },
      archive: async () => {},
      unarchive: async () => {},
      delete: async (remoteId: string) => {
        if (authenticated) {
          await deleteThreadApi(projectId, remoteId);
          removeThreadHistoryFromStorage(projectId, remoteId, userScope);
          return;
        }
        setGuestThreads((prev) => {
          const next = prev.filter((thread) => thread.id !== remoteId);
          guestThreadStore.set(projectId, next);
          return next;
        });
        removeThreadHistoryFromMemory(projectId, remoteId, userScope);
      },
      generateTitle: async (remoteId: string, messages: readonly ThreadMessage[]) => {
        const title = makeThreadSummaryTitle(messages);
        if (authenticated) {
          await persistThread(projectId, remoteId, title).catch(() => {});
        } else {
          setGuestThreads((prev) => {
            const next = prev.some((thread) => thread.id === remoteId)
              ? prev.map((thread) =>
                  thread.id === remoteId ? { ...thread, title } : thread,
                )
              : [...prev, { id: remoteId, title, createdAt: new Date().toISOString() }];
            guestThreadStore.set(projectId, next);
            return next;
          });
        }

        return new ReadableStream({
          start(controller) {
            controller.enqueue({
              type: "part-start",
              path: [0],
              part: { type: "text" },
            });
            controller.enqueue({
              type: "text-delta",
              path: [0],
              textDelta: title,
            });
            controller.enqueue({
              type: "message-finish",
              path: [],
              finishReason: "stop",
              usage: {
                promptTokens: 0,
                completionTokens: 0,
              },
            });
            controller.close();
          },
        });
      },
      fetch: async (threadId: string) => {
        const threads = authenticated ? await fetchThreads(projectId) : guestThreads;
        const thread = threads.find((item) => item.id === threadId);
        if (!thread) throw new Error("Thread not found");

        return {
          status: "regular" as const,
          remoteId: thread.id,
          title: thread.title || undefined,
          externalId: undefined,
        };
      },
      unstable_Provider: ({ children }) => (
        <ThreadPersistenceProvider
          projectId={projectId}
          authenticated={authenticated}
          userScope={userScope}
        >
          {children}
        </ThreadPersistenceProvider>
      ),
    }),
    [projectId, authenticated, userScope, guestThreads],
  );
}
