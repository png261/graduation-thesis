import { API_URL, apiJson, apiRequest } from "../client";
import type { GitHubRepo, GitHubSession, ProjectGitHubStatus, PullRequestResult } from "./types";

export function getGitHubLoginUrl(): string {
  return `${API_URL}/api/github/login`;
}

export async function getGitHubSession(): Promise<GitHubSession> {
  const res = await apiRequest("/api/github/session", {
    credentials: "include",
  });
  return apiJson<GitHubSession>(res);
}

export async function logoutGitHub(): Promise<void> {
  const res = await apiRequest("/api/github/logout", {
    method: "POST",
    credentials: "include",
  });
  await apiJson(res);
}

export async function listGitHubRepos(): Promise<GitHubRepo[]> {
  const res = await apiRequest("/api/github/repos", {
    credentials: "include",
  });
  const data = await apiJson<{ repos: GitHubRepo[] }>(res);
  return data.repos;
}

export async function createGitHubRepository(
  name: string,
  description: string,
  isPrivate: boolean,
): Promise<GitHubRepo> {
  const res = await apiRequest("/api/github/repos", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      description,
      private: isPrivate,
    }),
  });
  const data = await apiJson<{ repo: GitHubRepo }>(res);
  return data.repo;
}

export async function getProjectGitHubStatus(projectId: string): Promise<ProjectGitHubStatus> {
  const res = await apiRequest(`/api/projects/${projectId}/github`, {
    credentials: "include",
  });
  return apiJson<ProjectGitHubStatus>(res);
}

export async function connectProjectGitHub(
  projectId: string,
  repoFullName: string,
  baseBranch: string,
): Promise<ProjectGitHubStatus> {
  const res = await apiRequest(`/api/projects/${projectId}/github/connect`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repo_full_name: repoFullName,
      base_branch: baseBranch || null,
    }),
  });
  return apiJson<ProjectGitHubStatus>(res);
}

export async function disconnectProjectGitHub(projectId: string): Promise<ProjectGitHubStatus> {
  const res = await apiRequest(`/api/projects/${projectId}/github/disconnect`, {
    method: "POST",
    credentials: "include",
  });
  return apiJson<ProjectGitHubStatus>(res);
}

export async function createProjectPullRequest(
  projectId: string,
  title: string,
  description: string,
  baseBranch: string,
): Promise<PullRequestResult> {
  const res = await apiRequest(`/api/projects/${projectId}/github/pull-request`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      description,
      base_branch: baseBranch || null,
    }),
  });
  return apiJson<PullRequestResult>(res);
}
