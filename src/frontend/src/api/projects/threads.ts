import { apiJson, apiRequest } from "../client";
import type { Thread } from "./types";

export async function fetchThreads(projectId: string): Promise<Thread[]> {
  const res = await apiRequest(`/api/projects/${projectId}/threads`, {
    credentials: "include",
  });
  const data = await apiJson<{ threads: Thread[] }>(res);
  return data.threads;
}

export async function persistThread(
  projectId: string,
  threadId: string,
  title = "",
): Promise<void> {
  const res = await apiRequest(`/api/projects/${projectId}/threads`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: threadId, title }),
  });
  await apiJson(res);
}

export async function deleteThreadApi(projectId: string, threadId: string): Promise<void> {
  const res = await apiRequest(`/api/projects/${projectId}/threads/${threadId}`, {
    method: "DELETE",
    credentials: "include",
  });
  await apiJson(res);
}
