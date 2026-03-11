import { useCallback, useEffect, useMemo, useState } from "react";

import {
  connectProjectGitHub,
  disconnectProjectGitHub,
  getGitHubSession,
  getProjectGitHubStatus,
  listGitHubRepos,
  type GitHubRepo,
  type GitHubSession,
  type ProjectGitHubStatus,
} from "../../api/projects/index";

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function preferredRepoName(status: ProjectGitHubStatus, repos: GitHubRepo[]): string {
  return status.repo_full_name || repos[0]?.full_name || "";
}

function preferredBaseBranch(status: ProjectGitHubStatus, repos: GitHubRepo[], repoName: string): string {
  return status.base_branch || repos.find((repo) => repo.full_name === repoName)?.default_branch || "";
}

function useConnectionState() {
  const [githubSession, setGitHubSession] = useState<GitHubSession>({ authenticated: false });
  const [githubStatus, setGitHubStatus] = useState<ProjectGitHubStatus | null>(null);
  const [githubRepos, setGitHubRepos] = useState<GitHubRepo[]>([]);
  const [githubBusy, setGitHubBusy] = useState(false);
  const [githubError, setGitHubError] = useState("");
  return { githubSession, setGitHubSession, githubStatus, setGitHubStatus, githubRepos, setGitHubRepos, githubBusy, setGitHubBusy, githubError, setGitHubError };
}

function useSelectionState() {
  const [selectedRepo, setSelectedRepo] = useState("");
  const [selectedBaseBranch, setSelectedBaseBranch] = useState("");
  return { selectedRepo, setSelectedRepo, selectedBaseBranch, setSelectedBaseBranch };
}

function usePullRequestState() {
  const [pullRequestModalOpen, setPullRequestModalOpen] = useState(false);
  const [lastPullRequestUrl, setLastPullRequestUrl] = useState("");
  return { pullRequestModalOpen, setPullRequestModalOpen, lastPullRequestUrl, setLastPullRequestUrl };
}

function applyUnauthenticatedState(
  status: ProjectGitHubStatus,
  setGitHubRepos: (repos: GitHubRepo[]) => void,
  setSelectedRepo: (value: string) => void,
  setSelectedBaseBranch: (value: string | ((prev: string) => string)) => void,
) {
  setGitHubRepos([]);
  setSelectedRepo("");
  setSelectedBaseBranch((prev) => prev || status.base_branch || "");
}

function applyAuthenticatedSelection(
  status: ProjectGitHubStatus,
  repos: GitHubRepo[],
  setSelectedRepo: (value: string | ((prev: string) => string)) => void,
  setSelectedBaseBranch: (value: string | ((prev: string) => string)) => void,
) {
  const preferredRepo = preferredRepoName(status, repos);
  setSelectedRepo((prev) => (prev && repos.some((repo) => repo.full_name === prev) ? prev : preferredRepo));
  const branch = preferredBaseBranch(status, repos, preferredRepo);
  setSelectedBaseBranch((prev) => prev || branch);
}

function useGitHubRefresh(
  projectId: string,
  connection: ReturnType<typeof useConnectionState>,
  selection: ReturnType<typeof useSelectionState>,
) {
  const {
    setGitHubError,
    setGitHubSession,
    setGitHubStatus,
    setGitHubRepos,
  } = connection;
  const { setSelectedRepo, setSelectedBaseBranch } = selection;
  return useCallback(async () => {
    setGitHubError("");
    try {
      const [session, status] = await Promise.all([getGitHubSession(), getProjectGitHubStatus(projectId)]);
      setGitHubSession(session);
      setGitHubStatus(status);
      if (!session.authenticated) {
        applyUnauthenticatedState(status, setGitHubRepos, setSelectedRepo, setSelectedBaseBranch);
        return;
      }
      const repos = await listGitHubRepos();
      setGitHubRepos(repos);
      applyAuthenticatedSelection(status, repos, setSelectedRepo, setSelectedBaseBranch);
    } catch (error: unknown) {
      setGitHubError(toErrorMessage(error, "Failed to refresh GitHub state"));
    }
  }, [projectId, setGitHubError, setGitHubRepos, setGitHubSession, setGitHubStatus, setSelectedBaseBranch, setSelectedRepo]);
}

function useGitHubLoadEffect(projectId: string, refreshGitHubStatus: () => Promise<void>, setGitHubError: (value: string) => void) {
  useEffect(() => {
    setGitHubError("");
    void refreshGitHubStatus();
  }, [projectId, refreshGitHubStatus, setGitHubError]);
}

function useWindowFocusRefresh(refreshGitHubStatus: () => Promise<void>) {
  useEffect(() => {
    const onWindowFocus = () => {
      void refreshGitHubStatus();
    };
    window.addEventListener("focus", onWindowFocus);
    return () => {
      window.removeEventListener("focus", onWindowFocus);
    };
  }, [refreshGitHubStatus]);
}

function useGitHubActions(
  projectId: string,
  connection: ReturnType<typeof useConnectionState>,
  selection: ReturnType<typeof useSelectionState>,
  refreshGitHubStatus: () => Promise<void>,
) {
  const handleConnectGitHub = useConnectGitHubAction(projectId, connection, selection, refreshGitHubStatus);
  const handleDisconnectGitHub = useDisconnectGitHubAction(projectId, connection, refreshGitHubStatus);
  return { handleConnectGitHub, handleDisconnectGitHub };
}

function useConnectGitHubAction(
  projectId: string,
  connection: ReturnType<typeof useConnectionState>,
  selection: ReturnType<typeof useSelectionState>,
  refreshGitHubStatus: () => Promise<void>,
) {
  const { selectedRepo, selectedBaseBranch } = selection;
  const { setGitHubBusy, setGitHubError, setGitHubStatus } = connection;
  return useCallback(async () => {
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
      setGitHubError(toErrorMessage(error, "Failed to connect repository"));
    } finally {
      setGitHubBusy(false);
    }
  }, [projectId, refreshGitHubStatus, selectedBaseBranch, selectedRepo, setGitHubBusy, setGitHubError, setGitHubStatus]);
}

function useDisconnectGitHubAction(
  projectId: string,
  connection: ReturnType<typeof useConnectionState>,
  refreshGitHubStatus: () => Promise<void>,
) {
  const { setGitHubBusy, setGitHubError, setGitHubStatus } = connection;
  return useCallback(async () => {
    setGitHubBusy(true);
    setGitHubError("");
    try {
      const data = await disconnectProjectGitHub(projectId);
      setGitHubStatus(data);
      await refreshGitHubStatus();
    } catch (error: unknown) {
      setGitHubError(toErrorMessage(error, "Failed to disconnect repository"));
    } finally {
      setGitHubBusy(false);
    }
  }, [projectId, refreshGitHubStatus, setGitHubBusy, setGitHubError, setGitHubStatus]);
}

function buildHookResult(
  connection: ReturnType<typeof useConnectionState>,
  selection: ReturnType<typeof useSelectionState>,
  pullRequest: ReturnType<typeof usePullRequestState>,
  selectedRepoDefaultBranch: string,
  refreshGitHubStatus: () => Promise<void>,
  actions: ReturnType<typeof useGitHubActions>,
) {
  return {
    githubSession: connection.githubSession,
    githubStatus: connection.githubStatus,
    githubRepos: connection.githubRepos,
    githubBusy: connection.githubBusy,
    githubError: connection.githubError,
    selectedRepo: selection.selectedRepo,
    setSelectedRepo: selection.setSelectedRepo,
    selectedBaseBranch: selection.selectedBaseBranch,
    setSelectedBaseBranch: selection.setSelectedBaseBranch,
    selectedRepoDefaultBranch,
    pullRequestModalOpen: pullRequest.pullRequestModalOpen,
    setPullRequestModalOpen: pullRequest.setPullRequestModalOpen,
    lastPullRequestUrl: pullRequest.lastPullRequestUrl,
    setLastPullRequestUrl: pullRequest.setLastPullRequestUrl,
    refreshGitHubStatus,
    handleConnectGitHub: actions.handleConnectGitHub,
    handleDisconnectGitHub: actions.handleDisconnectGitHub,
  };
}

export function useGitHubConfigState(projectId: string) {
  const connection = useConnectionState();
  const selection = useSelectionState();
  const pullRequest = usePullRequestState();
  const refreshGitHubStatus = useGitHubRefresh(projectId, connection, selection);
  useGitHubLoadEffect(projectId, refreshGitHubStatus, connection.setGitHubError);
  useWindowFocusRefresh(refreshGitHubStatus);
  const actions = useGitHubActions(projectId, connection, selection, refreshGitHubStatus);
  const selectedRepoDefaultBranch = useMemo(() => connection.githubRepos.find((repo) => repo.full_name === selection.selectedRepo)?.default_branch || "", [connection.githubRepos, selection.selectedRepo]);
  return buildHookResult(connection, selection, pullRequest, selectedRepoDefaultBranch, refreshGitHubStatus, actions);
}
