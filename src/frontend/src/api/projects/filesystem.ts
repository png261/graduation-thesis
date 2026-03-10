import { apiJson, apiRequest } from "../client";
import type { FileEntry } from "./types";

export async function listProjectFiles(projectId: string): Promise<FileEntry[]> {
  const res = await apiRequest(`/api/projects/${projectId}/files`, {
    credentials: "include",
    cache: "no-store",
  });
  const data = await apiJson<{ files: FileEntry[] }>(res);
  return data.files ?? [];
}

export async function readProjectFile(projectId: string, path: string): Promise<string> {
  const res = await apiRequest(
    `/api/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`,
    {
      credentials: "include",
      cache: "no-store",
    },
  );
  const data = await apiJson<{ content: string }>(res);
  return data.content ?? "";
}

export async function writeProjectFile(
  projectId: string,
  path: string,
  content: string,
): Promise<void> {
  const res = await apiRequest(`/api/projects/${projectId}/files/content`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
  await apiJson(res);
}

export async function deleteProjectFile(projectId: string, path: string): Promise<void> {
  const res = await apiRequest(
    `/api/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`,
    {
      method: "DELETE",
      credentials: "include",
    },
  );
  await apiJson(res);
}

export async function uploadProjectZip(
  projectId: string,
  file: File,
): Promise<{ ok: boolean; imported_files: number }> {
  const form = new FormData();
  form.append("file", file);
  const res = await apiRequest(`/api/projects/${projectId}/files/import-zip`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  return apiJson<{ ok: boolean; imported_files: number }>(res);
}
