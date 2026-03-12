import { apiJson, apiRequest } from "../client";
import type { AnsibleStatus } from "./types";

export async function getAnsibleStatus(projectId: string): Promise<AnsibleStatus> {
  const res = await apiRequest(`/api/projects/${projectId}/ansible/status`, {
    credentials: "include",
  });
  return apiJson<AnsibleStatus>(res);
}

export async function runAnsibleConfigStream(
  projectId: string,
  selectedModules: string[],
  intent: string,
): Promise<Response> {
  return apiRequest(`/api/projects/${projectId}/ansible/run/stream`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      selected_modules: selectedModules,
      intent: intent || null,
    }),
  });
}
