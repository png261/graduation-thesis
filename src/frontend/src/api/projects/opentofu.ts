import { apiJson, apiRequest } from "../client";
import type { OpenTofuCostResult, OpenTofuGraphResult, OpenTofuPreviewResult, OpenTofuStatus } from "./types";

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
): Promise<Response> {
  return apiRequest(`/api/projects/${projectId}/opentofu/deploy/apply/stream`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      selected_modules: selectedModules,
      intent: intent || null,
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
