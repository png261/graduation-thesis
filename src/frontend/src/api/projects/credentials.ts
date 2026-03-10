import { apiJson, apiRequest } from "../client";
import type { CredentialsData } from "./types";

export async function getCredentials(
  projectId: string,
  options?: { signal?: AbortSignal },
): Promise<CredentialsData> {
  const res = await apiRequest(`/api/projects/${projectId}/credentials`, {
    credentials: "include",
    signal: options?.signal,
  });
  return apiJson<CredentialsData>(res);
}

export async function updateCredentials(
  projectId: string,
  credentials: Record<string, string>,
): Promise<void> {
  const res = await apiRequest(`/api/projects/${projectId}/credentials`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credentials }),
  });
  await apiJson(res);
}
