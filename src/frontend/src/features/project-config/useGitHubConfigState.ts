import { useEffect, useMemo, useState } from "react";

import {
  connectProjectGitHub,
  disconnectProjectGitHub,
  getGitHubSession,
  getProjectGitHubStatus,
  listGitHubRepos,
  logoutGitHub,
  type GitHubRepo,
  type GitHubSession,
  type ProjectGitHubStatus,
} from "../../api/projects/index";

export function useGitHubConfigState(projectId: string) {
  const [githubSession, setGitHubSession] = useState<GitHubSession>({ authenticated: false });
  const [githubStatus, setGitHubStatus] = useState<ProjectGitHubStatus | null>(null);
  const [githubRepos, setGitHubRepos] = useState<GitHubRepo[]>([]);
  const [githubBusy, setGitHubBusy] = useState(false);
  const [githubError, setGitHubError] = useState("");
  const [selectedRepo, setSelectedRepo] = useState("");
  const [selectedBaseBranch, setSelectedBaseBranch] = useState("");
  const [pullRequestModalOpen, setPullRequestModalOpen] = useState(false);
  const [lastPullRequestUrl, setLastPullRequestUrl] = useState("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setGitHubError("");
      try {
        const [session, status] = await Promise.all([
          getGitHubSession(),
          getProjectGitHubStatus(projectId),
        ]);
        if (cancelled) return;

        setGitHubSession(session);
        setGitHubStatus(status);

        if (!session.authenticated) {
          setGitHubRepos([]);
          setSelectedRepo("");
          setSelectedBaseBranch(status.base_branch ?? "");
          return;
        }

        const repos = await listGitHubRepos();
        if (cancelled) return;
        setGitHubRepos(repos);

        const preferredRepo = status.repo_full_name || repos[0]?.full_name || "";
        setSelectedRepo((prev) =>
          prev && repos.some((repo) => repo.full_name === prev) ? prev : preferredRepo,
        );

        const preferredBranch =
          status.base_branch ||
          repos.find((repo) => repo.full_name === preferredRepo)?.default_branch ||
          "";
        setSelectedBaseBranch((prev) => prev || preferredBranch);
      } catch (error: unknown) {
        if (!cancelled) {
          setGitHubError(error instanceof Error ? error.message : "Failed to load GitHub state");
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const selectedRepoDefaultBranch = useMemo(
    () => githubRepos.find((repo) => repo.full_name === selectedRepo)?.default_branch || "",
    [githubRepos, selectedRepo],
  );

  const refreshGitHubStatus = async () => {
    setGitHubError("");
    try {
      const [session, status] = await Promise.all([
        getGitHubSession(),
        getProjectGitHubStatus(projectId),
      ]);
      setGitHubSession(session);
      setGitHubStatus(status);
      if (session.authenticated) {
        setGitHubRepos(await listGitHubRepos());
      } else {
        setGitHubRepos([]);
      }
    } catch (error: unknown) {
      setGitHubError(error instanceof Error ? error.message : "Failed to refresh GitHub state");
    }
  };

  const handleConnectGitHub = async () => {
    if (!selectedRepo) {
      setGitHubError("Please choose a repository.");
      return;
    }

    setGitHubBusy(true);
    setGitHubError("");
    try {
      const data = await connectProjectGitHub(projectId, selectedRepo, selectedBaseBranch);
      setGitHubStatus(data);
      await refreshGitHubStatus();
    } catch (error: unknown) {
      setGitHubError(error instanceof Error ? error.message : "Failed to connect repository");
    } finally {
      setGitHubBusy(false);
    }
  };

  const handleDisconnectGitHub = async () => {
    setGitHubBusy(true);
    setGitHubError("");
    try {
      const data = await disconnectProjectGitHub(projectId);
      setGitHubStatus(data);
      await refreshGitHubStatus();
    } catch (error: unknown) {
      setGitHubError(error instanceof Error ? error.message : "Failed to disconnect repository");
    } finally {
      setGitHubBusy(false);
    }
  };

  const handleLogoutGitHub = async () => {
    setGitHubBusy(true);
    setGitHubError("");
    try {
      await logoutGitHub();
      await refreshGitHubStatus();
    } catch (error: unknown) {
      setGitHubError(error instanceof Error ? error.message : "Failed to logout");
    } finally {
      setGitHubBusy(false);
    }
  };

  return {
    githubSession,
    githubStatus,
    githubRepos,
    githubBusy,
    githubError,
    selectedRepo,
    setSelectedRepo,
    selectedBaseBranch,
    setSelectedBaseBranch,
    selectedRepoDefaultBranch,
    pullRequestModalOpen,
    setPullRequestModalOpen,
    lastPullRequestUrl,
    setLastPullRequestUrl,
    handleConnectGitHub,
    handleDisconnectGitHub,
    handleLogoutGitHub,
  };
}
