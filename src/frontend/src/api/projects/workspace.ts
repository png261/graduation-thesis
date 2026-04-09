import { apiJson, apiRequest } from "../client";

export async function getMemory(projectId: string): Promise<string> {
  const res = await apiRequest(`/api/projects/${projectId}/memory`, { credentials: "include" });
  const data = await apiJson<{ content: string }>(res);
  return data.content;
}

export async function updateMemory(projectId: string, content: string): Promise<void> {
  const res = await apiRequest(`/api/projects/${projectId}/memory`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  await apiJson(res);
}

export async function downloadProjectZip(projectId: string): Promise<Blob> {
  const res = await apiRequest(`/api/projects/${projectId}/files/export.zip`, {
    credentials: "include",
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(msg || "Failed to export project");
  }
  return res.blob();
}
