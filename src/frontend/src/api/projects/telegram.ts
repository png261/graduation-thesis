import { apiJson, apiRequest } from "../client";
import type { ProjectTelegramConnectResult, ProjectTelegramStatus } from "./types";

export async function getProjectTelegramStatus(projectId: string): Promise<ProjectTelegramStatus> {
  const res = await apiRequest(`/api/projects/${projectId}/telegram`, {
    credentials: "include",
  });
  return apiJson<ProjectTelegramStatus>(res);
}

export async function connectProjectTelegram(projectId: string): Promise<ProjectTelegramConnectResult> {
  const res = await apiRequest(`/api/projects/${projectId}/telegram/connect`, {
    method: "POST",
    credentials: "include",
  });
  return apiJson<ProjectTelegramConnectResult>(res);
}

export async function disconnectProjectTelegram(projectId: string): Promise<ProjectTelegramStatus> {
  const res = await apiRequest(`/api/projects/${projectId}/telegram/disconnect`, {
    method: "POST",
    credentials: "include",
  });
  return apiJson<ProjectTelegramStatus>(res);
}
