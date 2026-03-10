import { apiJson, apiRequest } from "../client";
import type { CloudProvider, Project } from "./types";

export async function listProjects(): Promise<Project[]> {
  const res = await apiRequest("/api/projects", { credentials: "include" });
  const data = await apiJson<{ projects: Project[] }>(res);
  return data.projects;
}

export async function createProject(
  name: string,
  provider: CloudProvider = "aws",
): Promise<Project> {
  const res = await apiRequest("/api/projects", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, provider }),
  });
  return apiJson<Project>(res);
}

export async function deleteProject(id: string): Promise<void> {
  const res = await apiRequest(`/api/projects/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  await apiJson(res);
}
