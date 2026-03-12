import { apiJson, apiRequest } from "../client";
import type { Skill } from "./types";

export async function getMemory(projectId: string): Promise<string> {
  const res = await apiRequest(`/api/projects/${projectId}/memory`, { credentials: "include" });
  const data = await apiJson<{ content: string }>(res);
  return data.content;
}

export async function updateMemory(projectId: string, content: string): Promise<void> {
  const res = await apiRequest(`/api/projects/${projectId}/memory`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  await apiJson(res);
}

export async function listSkills(projectId: string): Promise<Skill[]> {
  const res = await apiRequest(`/api/projects/${projectId}/skills`, { credentials: "include" });
  const data = await apiJson<{ skills: Skill[] }>(res);
  return data.skills;
}

export async function upsertSkill(
  projectId: string,
  skillName: string,
  content: string,
  description = "",
): Promise<void> {
  const res = await apiRequest(`/api/projects/${projectId}/skills/${encodeURIComponent(skillName)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, description }),
  });
  await apiJson(res);
}

export async function deleteSkill(projectId: string, skillName: string): Promise<void> {
  const res = await apiRequest(`/api/projects/${projectId}/skills/${encodeURIComponent(skillName)}`, {
    method: "DELETE",
    credentials: "include",
  });
  await apiJson(res);
}

export async function downloadProjectZip(projectId: string): Promise<Blob> {
  const res = await apiRequest(`/api/projects/${projectId}/files/export.zip`, {
    credentials: "include",
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(msg || "Failed to export project");
  }
  return res.blob();
}

export function buildSkillContent(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`;
}
