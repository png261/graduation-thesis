import { apiJson, apiRequest } from "../client";
import type {
  OpenTofuCostResult,
  OpenTofuGraphResult,
  OpenTofuPreviewResult,
  OpenTofuStatus,
  ProjectDriftStatus,
  ProjectRunHistoryResult,
} from "./types";

export async function getOpenTofuStatus(projectId: string): Promise<OpenTofuStatus> {
  const res = await apiRequest(`/api/projects/${projectId}/opentofu/status`, {
    credentials: "include",
  });
  return apiJson<OpenTofuStatus>(res);
}

export async function previewOpenTofuDeploy(
  projectId: string,
  intent: string,
): Promise<OpenTofuPreviewResult> {
  const res = await apiRequest(`/api/projects/${projectId}/opentofu/deploy/preview`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent: intent || null }),
  });
  return apiJson<OpenTofuPreviewResult>(res);
}

export async function applyOpenTofuDeployStream(
  projectId: string,
  selectedModules: string[],
  intent: string,
  options?: { overridePolicy?: boolean },
): Promise<Response> {
  return apiRequest(`/api/projects/${projectId}/opentofu/deploy/apply/stream`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      selected_modules: selectedModules,
      intent: intent || null,
      override_policy: Boolean(options?.overridePolicy),
    }),
  });
}

export async function planOpenTofuDeployStream(
  projectId: string,
  selectedModules: string[],
  intent: string,
): Promise<Response> {
  return apiRequest(`/api/projects/${projectId}/opentofu/deploy/plan/stream`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      selected_modules: selectedModules,
      intent: intent || null,
    }),
  });
}

export async function getOpenTofuCosts(
  projectId: string,
  options?: { module?: string; refresh?: boolean },
): Promise<OpenTofuCostResult> {
  const query = new URLSearchParams();
  if (options?.module) query.set("module", options.module);
  if (options?.refresh) query.set("refresh", "true");
  const suffix = query.size > 0 ? `?${query}` : "";
  const res = await apiRequest(`/api/projects/${projectId}/opentofu/costs${suffix}`, {
    credentials: "include",
  });
  return apiJson<OpenTofuCostResult>(res);
}

export async function getOpenTofuGraph(
  projectId: string,
  options?: { module?: string; type?: string; refresh?: boolean },
): Promise<OpenTofuGraphResult> {
  const query = new URLSearchParams();
  if (options?.module) query.set("module", options.module);
  if (options?.type) query.set("type", options.type);
  if (options?.refresh) query.set("refresh", "true");
  const suffix = query.size > 0 ? `?${query}` : "";
  const res = await apiRequest(`/api/projects/${projectId}/opentofu/graph${suffix}`, {
    credentials: "include",
  });
  return apiJson<OpenTofuGraphResult>(res);
}

export async function getProjectRunHistory(
  projectId: string,
  options?: { limit?: number; offset?: number },
): Promise<ProjectRunHistoryResult> {
  const query = new URLSearchParams();
  if (typeof options?.limit === "number") query.set("limit", String(options.limit));
  if (typeof options?.offset === "number") query.set("offset", String(options.offset));
  const suffix = query.size > 0 ? `?${query}` : "";
  const res = await apiRequest(`/api/projects/${projectId}/runs/history${suffix}`, {
    credentials: "include",
  });
  return apiJson<ProjectRunHistoryResult>(res);
}

export async function getProjectDriftStatus(projectId: string): Promise<ProjectDriftStatus> {
  const res = await apiRequest(`/api/projects/${projectId}/drift/status`, {
    credentials: "include",
  });
  return apiJson<ProjectDriftStatus>(res);
}
