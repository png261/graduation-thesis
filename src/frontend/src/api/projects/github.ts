import { apiJson, apiRequest } from "../client";
import type { GitHubRepo, GitHubSession, ProjectGitHubStatus, PullRequestResult } from "./types";

interface GitHubProjectApiErrorPayload {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  detail?: {
    code?: unknown;
    message?: unknown;
    details?: unknown;
  };
}

export class GitHubProjectApiError extends Error {
  status: number;
  code: string;
  details: unknown;

  constructor(message: string, status: number, code: string, details: unknown) {
    super(message);
    this.name = "GitHubProjectApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function readGitHubProjectApiPayload(data: unknown): {
  code: string;
  message: string;
  details: unknown;
} | null {
  if (!data || typeof data !== "object") return null;
  const payload = data as GitHubProjectApiErrorPayload;
  const detail = payload.detail && typeof payload.detail === "object" ? payload.detail : null;
  const code = detail?.code ?? payload.code;
  const message = detail?.message ?? payload.message;
  const details = detail?.details ?? payload.details;
  return {
    code: typeof code === "string" && code.trim() ? code : "github_project_error",
    message: typeof message === "string" && message.trim() ? message : "GitHub request failed",
    details,
  };
}

async function parseGitHubProjectApiError(response: Response): Promise<GitHubProjectApiError> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const parsed = readGitHubProjectApiPayload(payload);
  const fallbackMessage = response.statusText || "GitHub request failed";
  return new GitHubProjectApiError(
    parsed?.message || fallbackMessage,
    response.status,
    parsed?.code || "github_project_error",
    parsed?.details,
  );
}

async function parseGitHubProjectApiJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw await parseGitHubProjectApiError(response);
  }
  return response.json() as Promise<T>;
}

export function isGitHubProjectApiError(error: unknown): error is GitHubProjectApiError {
  return error instanceof GitHubProjectApiError;
}

export interface ProjectPullRequestDefaults {
  title: string;
  description: string;
  base_branch: string;
  working_branch: string;
  repo_full_name: string;
  source: "ansible_generation" | "terraform_generation" | "fallback";
  terraform_generation_id: string | null;
  ansible_generation_id: string | null;
}

export async function getGitHubOauthStart(): Promise<{ authorize_url: string }> {
  const res = await apiRequest("/api/github/oauth/start");
  return apiJson<{ authorize_url: string }>(res);
}

export async function getGitHubSession(): Promise<GitHubSession> {
  const res = await apiRequest("/api/github/session");
  return apiJson<GitHubSession>(res);
}

export async function listGitHubRepos(): Promise<GitHubRepo[]> {
  const res = await apiRequest("/api/github/repos");
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
  const res = await apiRequest(`/api/projects/${projectId}/github`);
  return apiJson<ProjectGitHubStatus>(res);
}

export async function connectProjectGitHub(
  projectId: string,
  repoFullName: string,
  baseBranch: string,
  confirmWorkspaceSwitch = false,
): Promise<ProjectGitHubStatus> {
  const res = await apiRequest(`/api/projects/${projectId}/github/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repo_full_name: repoFullName,
      base_branch: baseBranch || null,
      confirm_workspace_switch: confirmWorkspaceSwitch,
    }),
  });
  return parseGitHubProjectApiJson<ProjectGitHubStatus>(res);
}

export async function syncProjectGitHub(
  projectId: string,
  confirmWorkspaceSwitch = false,
): Promise<ProjectGitHubStatus> {
  const res = await apiRequest(`/api/projects/${projectId}/github/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      confirm_workspace_switch: confirmWorkspaceSwitch,
    }),
  });
  return parseGitHubProjectApiJson<ProjectGitHubStatus>(res);
}

export async function disconnectProjectGitHub(projectId: string): Promise<ProjectGitHubStatus> {
  const res = await apiRequest(`/api/projects/${projectId}/github/disconnect`, {
    method: "POST",
  });
  return apiJson<ProjectGitHubStatus>(res);
}

export async function getProjectPullRequestDefaults(
  projectId: string,
): Promise<ProjectPullRequestDefaults> {
  const res = await apiRequest(`/api/projects/${projectId}/github/pull-request/defaults`);
  return apiJson<ProjectPullRequestDefaults>(res);
}

export async function createProjectPullRequest(
  projectId: string,
  title: string,
  description: string,
  baseBranch: string,
): Promise<PullRequestResult> {
  const res = await apiRequest(`/api/projects/${projectId}/github/pull-request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      description,
      base_branch: baseBranch || null,
    }),
  });
  return apiJson<PullRequestResult>(res);
}
