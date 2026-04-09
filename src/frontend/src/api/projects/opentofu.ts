import { apiJson, apiRequest } from "../client";
import type {
  OpenTofuCostResult,
  OpenTofuGraphResult,
  OpenTofuPreviewResult,
  OpenTofuStatus,
  ProjectJob,
  ProjectDriftStatus,
  ProjectRunHistoryResult,
  ProjectSsmReadiness,
  ProjectTerraformTargetContract,
} from "./types";
import { rerunProjectJob } from "./jobs";

export interface OpenTofuDeployChecklistItem {
  name: string;
  ready: boolean;
  code: string;
  message: string;
}

export interface OpenTofuDeployConfirmation {
  project_name?: string;
  keyword?: string;
  selected_modules?: string[];
}

export interface OpenTofuDeployOptions {
  override_policy?: boolean;
  confirm_partial_scope?: boolean;
  confirm_partial_drift_override?: boolean;
}

interface BaseOpenTofuDeployRequest {
  selected_modules: string[];
  intent: string | null;
  review_session_id?: string | null;
  review_target?: "apply" | "destroy" | null;
  scope_mode?: "full" | "partial" | null;
  confirmation?: OpenTofuDeployConfirmation | null;
  options?: OpenTofuDeployOptions;
}

export interface PlanOpenTofuDeployRequest extends BaseOpenTofuDeployRequest {}
export interface ApplyOpenTofuDeployRequest extends BaseOpenTofuDeployRequest {
  options?: OpenTofuDeployOptions;
}
export interface DestroyOpenTofuDeployRequest extends BaseOpenTofuDeployRequest {}

export interface OpenTofuDeployPreflight {
  primary_blocker_code: string | null;
  primary_blocker_message: string;
  generation_gate: {
    terraform_generated: boolean;
    terraform_ready: boolean;
    ansible_ready: boolean;
    ansible_required: boolean;
    target_contract_ready: boolean;
    target_contract_stale: boolean;
    blocking: boolean;
  };
  target_contract: ProjectTerraformTargetContract;
  ssm_readiness: ProjectSsmReadiness;
  credential_gate: {
    status: string;
    blocking: boolean;
    missing_fields: string[];
  };
  review_gate: {
    status: string;
    blocking: boolean;
    message: string;
  } & Record<string, unknown>;
  drift_refresh: {
    source: string;
    status: string;
    blocking: boolean;
    reason: string;
    primary_backend: Record<string, unknown> | null;
    last_successful_refresh_at: string | null;
    freshness_minutes: number | null;
    active_drift_alert_count: number;
    fallback_runtime: Record<string, unknown> | null;
  };
  checklist: OpenTofuDeployChecklistItem[];
}

export async function getOpenTofuStatus(projectId: string): Promise<OpenTofuStatus> {
  const res = await apiRequest(`/api/projects/${projectId}/opentofu/status`, {
    credentials: "include",
  });
  return apiJson<OpenTofuStatus>(res);
}

export async function getOpenTofuDeployPreflight(
  projectId: string,
  options?: {
    signal?: AbortSignal;
    reviewSessionId?: string;
    reviewTarget?: "apply" | "destroy";
    selectedModules?: string[];
    scopeMode?: "full" | "partial";
  },
): Promise<OpenTofuDeployPreflight> {
  const query = new URLSearchParams();
  if (options?.reviewSessionId) query.set("review_session_id", options.reviewSessionId);
  if (options?.reviewTarget) query.set("review_target", options.reviewTarget);
  if (options?.scopeMode) query.set("scope_mode", options.scopeMode);
  for (const moduleName of options?.selectedModules ?? []) {
    query.append("selected_modules", moduleName);
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const res = await apiRequest(`/api/projects/${projectId}/opentofu/deploy/preflight${suffix}`, {
    credentials: "include",
    signal: options?.signal,
  });
  return apiJson<OpenTofuDeployPreflight>(res);
}

export async function validateOpenTofuTargetContract(
  projectId: string,
): Promise<ProjectTerraformTargetContract> {
  const res = await apiRequest(`/api/projects/${projectId}/opentofu/target-contract/validate`, {
    method: "POST",
    credentials: "include",
  });
  const payload = await apiJson<{ target_contract: ProjectTerraformTargetContract }>(res);
  return payload.target_contract;
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
  payload: ApplyOpenTofuDeployRequest,
): Promise<Response> {
  return apiRequest(`/api/projects/${projectId}/opentofu/deploy/apply/stream`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      selected_modules: payload.selected_modules,
      intent: payload.intent || null,
      override_policy: Boolean(payload.options?.override_policy),
      review_session_id: payload.review_session_id ?? null,
      review_target: payload.review_target ?? null,
      scope_mode: payload.scope_mode ?? null,
      confirmation: payload.confirmation ?? null,
      options: payload.options ?? {},
    }),
  });
}

export async function planOpenTofuDeployStream(
  projectId: string,
  payload: PlanOpenTofuDeployRequest,
): Promise<Response> {
  return apiRequest(`/api/projects/${projectId}/opentofu/deploy/plan/stream`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      selected_modules: payload.selected_modules,
      intent: payload.intent || null,
      review_session_id: payload.review_session_id ?? null,
      review_target: payload.review_target ?? null,
      scope_mode: payload.scope_mode ?? null,
      confirmation: payload.confirmation ?? null,
      options: payload.options ?? {},
    }),
  });
}

export async function destroyOpenTofuDeployStream(
  projectId: string,
  payload: DestroyOpenTofuDeployRequest,
): Promise<Response> {
  return apiRequest(`/api/projects/${projectId}/opentofu/deploy/destroy/stream`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      selected_modules: payload.selected_modules,
      intent: payload.intent || null,
      review_session_id: payload.review_session_id ?? null,
      review_target: payload.review_target ?? null,
      scope_mode: payload.scope_mode ?? null,
      confirmation: payload.confirmation ?? null,
      options: payload.options ?? {},
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

export async function rerunPostDeployChecks(projectId: string, jobId: string): Promise<ProjectJob> {
  return rerunProjectJob(projectId, jobId, {
    options: { post_deploy_only: true },
  });
}

export async function getProjectDriftStatus(projectId: string): Promise<ProjectDriftStatus> {
  const res = await apiRequest(`/api/projects/${projectId}/drift/status`, {
    credentials: "include",
  });
  return apiJson<ProjectDriftStatus>(res);
}
