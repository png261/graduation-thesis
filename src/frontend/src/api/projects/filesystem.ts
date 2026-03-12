import { API_URL, apiJson, apiRequest } from "../client";
import type { FileEntry, PathMove } from "./types";
import { downloadProjectZip } from "./workspace";
import JSZip from "jszip";

type ProjectBlobReadStrategy = "contentRaw" | "legacyRaw" | "zipOnly";

const projectStrategyCache = new Map<string, ProjectBlobReadStrategy>();
const projectZipCache = new Map<string, Promise<JSZip>>();
const blobCache = new Map<string, Blob>();

export async function listProjectFiles(projectId: string): Promise<FileEntry[]> {
  const res = await apiRequest(`/api/projects/${projectId}/files`, {
    credentials: "include",
    cache: "no-store",
  });
  const data = await apiJson<{ files: FileEntry[] }>(res);
  return data.files ?? [];
}

export async function getProjectFileSignedUrl(projectId: string, path: string): Promise<string> {
  const res = await apiRequest(
    `/api/projects/${projectId}/files/signed-url?path=${encodeURIComponent(path)}`,
    {
      credentials: "include",
      cache: "no-store",
    },
  );
  const data = await apiJson<{ url: string }>(res);
  const url = data.url ?? "";
  if (!url) throw new Error("Missing signed URL");
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${API_URL}${url}`;
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

function parseErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object") {
    const detail = (data as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (detail && typeof detail === "object") {
      const message = (detail as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message;
      return JSON.stringify(detail);
    }
    const message = (data as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function blobCacheKey(projectId: string, path: string): string {
  return `${projectId}:${path}`;
}

function relativePath(path: string): string {
  return path.replace(/^\/+/, "");
}

async function loadProjectZip(projectId: string, forceRefresh = false): Promise<JSZip> {
  if (forceRefresh || !projectZipCache.has(projectId)) {
    const promise = downloadProjectZip(projectId).then((archive) => JSZip.loadAsync(archive));
    projectZipCache.set(projectId, promise);
  }
  const zip = projectZipCache.get(projectId);
  if (!zip) throw new Error("Failed to load project archive");
  return zip;
}

async function readBlobFromProjectZip(projectId: string, path: string): Promise<Blob> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const zip = await loadProjectZip(projectId, attempt > 0);
    const entry = zip.file(relativePath(path));
    if (entry) return entry.async("blob");
  }
  throw new Error(`File '${path}' not found in project archive`);
}

function endpointOrderForStrategy(projectId: string): string[] {
  const contentRaw = `/api/projects/${projectId}/files/content?path=__PATH__&raw=1`;
  const legacyRaw = `/api/projects/${projectId}/files/raw?path=__PATH__`;
  const strategy = projectStrategyCache.get(projectId);
  if (strategy === "contentRaw") return [contentRaw];
  if (strategy === "legacyRaw") return [legacyRaw];
  if (strategy === "zipOnly") return [];
  return [contentRaw, legacyRaw];
}

export async function readProjectFileBlob(projectId: string, path: string): Promise<Blob> {
  const cacheKey = blobCacheKey(projectId, path);
  const cachedBlob = blobCache.get(cacheKey);
  if (cachedBlob) return cachedBlob;

  let lastError = `Failed to read file '${path}'`;
  const failures: Array<{ status: number; message: string }> = [];
  const encodedPath = encodeURIComponent(path);
  const endpoints = endpointOrderForStrategy(projectId).map((url) => url.replace("__PATH__", encodedPath));

  for (const url of endpoints) {
    const res = await apiRequest(url, {
      credentials: "include",
      cache: "no-store",
    });
    if (res.ok) {
      const blob = await res.blob();
      blobCache.set(cacheKey, blob);
      if (url.includes("/files/content?")) projectStrategyCache.set(projectId, "contentRaw");
      else projectStrategyCache.set(projectId, "legacyRaw");
      return blob;
    }

    let message = lastError;
    try {
      const data = await res.json();
      message = parseErrorMessage(data, lastError);
    } catch {
      const text = await res.text().catch(() => "");
      if (text.trim()) message = text.trim();
    }
    failures.push({ status: res.status, message });
    lastError = message;
  }

  try {
    const blob = await readBlobFromProjectZip(projectId, path);
    blobCache.set(cacheKey, blob);
    projectStrategyCache.set(projectId, "zipOnly");
    return blob;
  } catch {
    // Keep original endpoint error reporting below.
  }

  if (failures.length > 0) {
    const lastFailure = failures[failures.length - 1];
    throw new Error(`${lastFailure.message} (status ${lastFailure.status})`);
  }
  throw new Error(lastError);
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

export async function moveProjectPaths(
  projectId: string,
  sourcePaths: string[],
  destinationDir: string,
): Promise<{ ok: boolean; moved: PathMove[] }> {
  const res = await apiRequest(`/api/projects/${projectId}/files/move`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_paths: sourcePaths, destination_dir: destinationDir }),
  });
  return apiJson<{ ok: boolean; moved: PathMove[] }>(res);
}

export async function renameProjectPath(
  projectId: string,
  path: string,
  newName: string,
): Promise<{ ok: boolean; moved: PathMove }> {
  const res = await apiRequest(`/api/projects/${projectId}/files/rename`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, new_name: newName }),
  });
  return apiJson<{ ok: boolean; moved: PathMove }>(res);
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
