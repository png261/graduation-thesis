import { apiJson, apiRequest } from "../client";
import type { GitLabRepo, GitLabSession } from "./types";

export async function getGitLabSession(): Promise<GitLabSession> {
  const res = await apiRequest("/api/gitlab/session", {
    credentials: "include",
  });
  return apiJson<GitLabSession>(res);
}

export async function getGitLabOauthStart(): Promise<{ authorize_url: string }> {
  const res = await apiRequest("/api/gitlab/oauth/start", {
    credentials: "include",
  });
  return apiJson<{ authorize_url: string }>(res);
}

export async function listGitLabRepos(): Promise<GitLabRepo[]> {
  const res = await apiRequest("/api/gitlab/repos", {
    credentials: "include",
  });
  const data = await apiJson<{ repos: GitLabRepo[] }>(res);
  return data.repos;
}
