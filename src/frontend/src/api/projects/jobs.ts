import { apiJson, apiRequest } from "../client";
import type { EnqueueProjectJobBody, ProjectJob, ProjectJobListResult, ProjectJobKind, ProjectJobStatus } from "./types";

export async function enqueueProjectJob(projectId: string, body: EnqueueProjectJobBody): Promise<ProjectJob> {
  const res = await apiRequest(`/api/projects/${projectId}/jobs`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return apiJson<ProjectJob>(res);
}

export async function listProjectJobs(
  projectId: string,
  options?: { status?: ProjectJobStatus | ""; kind?: ProjectJobKind | ""; limit?: number; offset?: number },
): Promise<ProjectJobListResult> {
  const query = new URLSearchParams();
  if (options?.status) query.set("status", options.status);
  if (options?.kind) query.set("kind", options.kind);
  if (typeof options?.limit === "number") query.set("limit", String(options.limit));
  if (typeof options?.offset === "number") query.set("offset", String(options.offset));
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const res = await apiRequest(`/api/projects/${projectId}/jobs${suffix}`, {
    credentials: "include",
  });
  return apiJson<ProjectJobListResult>(res);
}

export async function getProjectJob(projectId: string, jobId: string): Promise<ProjectJob> {
  const res = await apiRequest(`/api/projects/${projectId}/jobs/${jobId}`, {
    credentials: "include",
  });
  return apiJson<ProjectJob>(res);
}

export async function streamProjectJobEvents(
  projectId: string,
  jobId: string,
  options?: { fromSeq?: number; signal?: AbortSignal },
): Promise<Response> {
  const query = new URLSearchParams();
  if (typeof options?.fromSeq === "number" && options.fromSeq > 0) {
    query.set("from_seq", String(options.fromSeq));
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return apiRequest(`/api/projects/${projectId}/jobs/${jobId}/events/stream${suffix}`, {
    credentials: "include",
    signal: options?.signal,
  });
}

export async function cancelProjectJob(projectId: string, jobId: string): Promise<ProjectJob> {
  const res = await apiRequest(`/api/projects/${projectId}/jobs/${jobId}/cancel`, {
    method: "POST",
    credentials: "include",
  });
  return apiJson<ProjectJob>(res);
}

export async function rerunProjectJob(
  projectId: string,
  jobId: string,
  options?: { options?: Record<string, unknown> },
): Promise<ProjectJob> {
  const res = await apiRequest(`/api/projects/${projectId}/jobs/${jobId}/rerun`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ options: options?.options ?? {} }),
  });
  return apiJson<ProjectJob>(res);
}
