import { apiJson, apiRequest } from "../client";
import type {
  DriftAlert,
  PolicyAlert,
  StateBackend,
  StateBackendImportCandidate,
  StateBackendSettings,
  StateHistoryItem,
  StateResource,
} from "./types";

export async function listStateBackends(projectId: string): Promise<StateBackend[]> {
  const res = await apiRequest(`/api/projects/${projectId}/state-backends`, {
    credentials: "include",
  });
  const data = await apiJson<{ backends: StateBackend[] }>(res);
  return data.backends;
}

export async function listCloudBuckets(
  projectId: string,
  options: { provider: string; credentialProfileId: string },
): Promise<string[]> {
  const query = new URLSearchParams({
    provider: options.provider,
    credential_profile_id: options.credentialProfileId,
  });
  const res = await apiRequest(`/api/projects/${projectId}/state-backends/import/cloud/buckets?${query.toString()}`, {
    credentials: "include",
  });
  const data = await apiJson<{ buckets: string[] }>(res);
  return data.buckets;
}

export async function listCloudObjects(
  projectId: string,
  options: { provider: string; credentialProfileId: string; bucket: string; prefix?: string },
): Promise<Array<{ key: string; size: number; updated_at: string | null }>> {
  const query = new URLSearchParams({
    provider: options.provider,
    credential_profile_id: options.credentialProfileId,
    bucket: options.bucket,
  });
  if (options.prefix) query.set("prefix", options.prefix);
  const res = await apiRequest(`/api/projects/${projectId}/state-backends/import/cloud/objects?${query.toString()}`, {
    credentials: "include",
  });
  const data = await apiJson<{ objects: Array<{ key: string; size: number; updated_at: string | null }> }>(res);
  return data.objects;
}

export async function importCloudStateBackend(
  projectId: string,
  payload: {
    provider: string;
    name?: string;
    credential_profile_id: string;
    bucket: string;
    key?: string;
    prefix?: string;
  },
): Promise<StateBackend> {
  const res = await apiRequest(`/api/projects/${projectId}/state-backends/import/cloud`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return apiJson<StateBackend>(res);
}

export async function importStateBackendFromGitHub(
  projectId: string,
  payload: {
    repo_full_name: string;
    branch?: string | null;
    credential_profile_id: string;
    dry_run?: boolean;
    selected_candidates?: StateBackendImportCandidate[];
  },
): Promise<{ discovered: StateBackendImportCandidate[]; created: StateBackend[] }> {
  const res = await apiRequest(`/api/projects/${projectId}/state-backends/import/github`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return apiJson<{ discovered: StateBackendImportCandidate[]; created: StateBackend[] }>(res);
}

export async function importStateBackendFromGitLab(
  projectId: string,
  payload: {
    repo_full_name: string;
    branch?: string | null;
    credential_profile_id: string;
    dry_run?: boolean;
    selected_candidates?: StateBackendImportCandidate[];
  },
): Promise<{ discovered: StateBackendImportCandidate[]; created: StateBackend[] }> {
  const res = await apiRequest(`/api/projects/${projectId}/state-backends/import/gitlab`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return apiJson<{ discovered: StateBackendImportCandidate[]; created: StateBackend[] }>(res);
}

export async function syncStateBackend(projectId: string, backendId: string): Promise<{ status: string; summary: Record<string, unknown> }> {
  const res = await apiRequest(`/api/projects/${projectId}/state-backends/${backendId}/sync`, {
    method: "POST",
    credentials: "include",
  });
  return apiJson<{ status: string; summary: Record<string, unknown> }>(res);
}

export async function getStateResources(
  projectId: string,
  backendId: string,
  options?: { search?: string; showSensitive?: boolean },
): Promise<StateResource[]> {
  const query = new URLSearchParams();
  if (options?.search) query.set("search", options.search);
  if (options?.showSensitive) query.set("show_sensitive", "true");
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const res = await apiRequest(`/api/projects/${projectId}/state-backends/${backendId}/resources${suffix}`, {
    credentials: "include",
  });
  const data = await apiJson<{ resources: StateResource[] }>(res);
  return data.resources;
}

export async function getStateHistory(projectId: string, backendId: string, search = ""): Promise<StateHistoryItem[]> {
  const query = search ? `?search=${encodeURIComponent(search)}` : "";
  const res = await apiRequest(`/api/projects/${projectId}/state-backends/${backendId}/history${query}`, {
    credentials: "include",
  });
  const data = await apiJson<{ history: StateHistoryItem[] }>(res);
  return data.history;
}

export async function getDriftAlerts(
  projectId: string,
  backendId: string,
  options?: { activeOnly?: boolean; search?: string },
): Promise<DriftAlert[]> {
  const query = new URLSearchParams();
  if (options?.activeOnly) query.set("active_only", "true");
  if (options?.search) query.set("search", options.search);
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const res = await apiRequest(`/api/projects/${projectId}/state-backends/${backendId}/drift-alerts${suffix}`, {
    credentials: "include",
  });
  const data = await apiJson<{ alerts: DriftAlert[] }>(res);
  return data.alerts;
}

export async function getPolicyAlerts(
  projectId: string,
  backendId: string,
  options?: { activeOnly?: boolean; search?: string },
): Promise<PolicyAlert[]> {
  const query = new URLSearchParams();
  if (options?.activeOnly) query.set("active_only", "true");
  if (options?.search) query.set("search", options.search);
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const res = await apiRequest(`/api/projects/${projectId}/state-backends/${backendId}/policy-alerts${suffix}`, {
    credentials: "include",
  });
  const data = await apiJson<{ alerts: PolicyAlert[] }>(res);
  return data.alerts;
}

export async function createDriftFixPlan(
  projectId: string,
  backendId: string,
  alertId: string,
): Promise<{ alert_id: string; plan: Record<string, unknown> }> {
  const res = await apiRequest(`/api/projects/${projectId}/state-backends/${backendId}/drift-alerts/${alertId}/fix-plan`, {
    method: "POST",
    credentials: "include",
  });
  return apiJson<{ alert_id: string; plan: Record<string, unknown> }>(res);
}

export async function createFixAllPlan(
  projectId: string,
  backendId: string,
): Promise<{ backend_id: string; count: number; plans: Array<Record<string, unknown>> }> {
  const res = await apiRequest(`/api/projects/${projectId}/state-backends/${backendId}/drift-alerts/fix-all-plan`, {
    method: "POST",
    credentials: "include",
  });
  return apiJson<{ backend_id: string; count: number; plans: Array<Record<string, unknown>> }>(res);
}

export async function getStateBackendSettings(projectId: string, backendId: string): Promise<StateBackendSettings> {
  const res = await apiRequest(`/api/projects/${projectId}/state-backends/${backendId}/settings`, {
    credentials: "include",
  });
  return apiJson<StateBackendSettings>(res);
}

export async function updateStateBackendSettings(
  projectId: string,
  backendId: string,
  payload: {
    name?: string;
    schedule_minutes?: number;
    retention_days?: number;
    settings?: Record<string, unknown>;
  },
): Promise<StateBackend> {
  const res = await apiRequest(`/api/projects/${projectId}/state-backends/${backendId}/settings`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return apiJson<StateBackend>(res);
}

export async function deleteStateBackend(projectId: string, backendId: string): Promise<void> {
  const res = await apiRequest(`/api/projects/${projectId}/state-backends/${backendId}`, {
    method: "DELETE",
    credentials: "include",
  });
  await apiJson<{ ok: boolean }>(res);
}
