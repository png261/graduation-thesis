import { useCallback, useEffect, useMemo, useState } from "react";

import {
  connectProjectGitHub,
  disconnectProjectGitHub,
  isGitHubProjectApiError,
  getGitHubSession,
  getProjectGitHubStatus,
  listGitHubRepos,
  syncProjectGitHub,
  type GitHubRepo,
  type GitHubSession,
  type ProjectGitHubStatus,
} from "../../api/projects/index";

type GitHubConfigActionMode = "connect" | "sync";

export interface PendingGitHubSettingsConfirmation {
  mode: GitHubConfigActionMode;
  repoFullName: string;
  baseBranch: string;
  confirmationMessage: string;
}

interface GitHubConfigRequest {
  mode: GitHubConfigActionMode;
  repoFullName: string;
  baseBranch: string;
  confirmWorkspaceSwitch: boolean;
}

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isWorkspaceSwitchConfirmationError(error: unknown): boolean {
  return isGitHubProjectApiError(error) && error.code === "workspace_switch_confirmation_required";
}

export function buildPendingSettingsConfirmation(
  mode: GitHubConfigActionMode,
  repoFullName: string,
  baseBranch: string,
  confirmationMessage: string,
): PendingGitHubSettingsConfirmation {
  return {
    mode,
    repoFullName,
    baseBranch,
    confirmationMessage,
  };
}

export function resolveGitHubConfigActionLabel(connected: boolean): string {
  return connected ? "Sync Repository Baseline" : "Connect Repository";
}

export function buildGitHubConfigRequest(args: {
  githubStatus: ProjectGitHubStatus | null;
  selectedRepo: string;
  selectedBaseBranch: string;
  pendingConfirmation: PendingGitHubSettingsConfirmation | null;
}): GitHubConfigRequest {
  if (args.pendingConfirmation) {
    return {
      mode: args.pendingConfirmation.mode,
      repoFullName: args.pendingConfirmation.repoFullName,
      baseBranch: args.pendingConfirmation.baseBranch,
      confirmWorkspaceSwitch: true,
    };
  }
  if (args.githubStatus?.connected) {
    return {
      mode: "sync",
      repoFullName: args.githubStatus.repo_full_name || args.selectedRepo,
      baseBranch: args.githubStatus.base_branch || args.selectedBaseBranch || "main",
      confirmWorkspaceSwitch: false,
    };
  }
  return {
    mode: "connect",
    repoFullName: args.selectedRepo,
    baseBranch: args.selectedBaseBranch,
    confirmWorkspaceSwitch: false,
  };
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
  const [pendingRepositoryConfirmation, setPendingRepositoryConfirmation] = useState<PendingGitHubSettingsConfirmation | null>(null);
  return { githubSession, setGitHubSession, githubStatus, setGitHubStatus, githubRepos, setGitHubRepos, githubBusy, setGitHubBusy, githubError, setGitHubError, pendingRepositoryConfirmation, setPendingRepositoryConfirmation };
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
  const handleSyncGitHub = useSyncGitHubAction(projectId, connection, selection, refreshGitHubStatus);
  const handleConfirmGitHubAction = useConfirmGitHubAction(projectId, connection, selection, refreshGitHubStatus);
  const handleDisconnectGitHub = useDisconnectGitHubAction(projectId, connection, refreshGitHubStatus);
  return { handleConnectGitHub, handleSyncGitHub, handleConfirmGitHubAction, handleDisconnectGitHub };
}

function validateGitHubConfigRequest(request: GitHubConfigRequest): string | null {
  if (request.mode === "connect" && !request.repoFullName) {
    return "Please choose a repository.";
  }
  return null;
}

async function submitGitHubConfigRequest(
  projectId: string,
  request: GitHubConfigRequest,
): Promise<ProjectGitHubStatus> {
  if (request.mode === "sync") {
    return syncProjectGitHub(projectId, request.confirmWorkspaceSwitch);
  }
  return connectProjectGitHub(
    projectId,
    request.repoFullName,
    request.baseBranch,
    request.confirmWorkspaceSwitch,
  );
}

function useExecuteGitHubAction(
  projectId: string,
  connection: ReturnType<typeof useConnectionState>,
  refreshGitHubStatus: () => Promise<void>,
  buildRequest: () => GitHubConfigRequest,
) {
  return useCallback(async () => {
    const request = buildRequest();
    const validationError = validateGitHubConfigRequest(request);
    if (validationError) {
      connection.setGitHubError(validationError);
      return;
    }
    connection.setGitHubBusy(true);
    connection.setGitHubError("");
    try {
      const data = await submitGitHubConfigRequest(projectId, request);
      connection.setPendingRepositoryConfirmation(null);
      connection.setGitHubStatus(data);
      await refreshGitHubStatus();
    } catch (error: unknown) {
      if (isWorkspaceSwitchConfirmationError(error)) {
        connection.setPendingRepositoryConfirmation(
          buildPendingSettingsConfirmation(
            request.mode,
            request.repoFullName,
            request.baseBranch,
            error.message,
          ),
        );
        connection.setGitHubError("");
      } else {
        connection.setPendingRepositoryConfirmation(null);
        connection.setGitHubError(
          toErrorMessage(
            error,
            request.mode === "sync" ? "Failed to sync repository baseline" : "Failed to connect repository",
          ),
        );
      }
    } finally {
      connection.setGitHubBusy(false);
    }
  }, [buildRequest, connection, projectId, refreshGitHubStatus]);
}

function useConnectGitHubAction(
  projectId: string,
  connection: ReturnType<typeof useConnectionState>,
  selection: ReturnType<typeof useSelectionState>,
  refreshGitHubStatus: () => Promise<void>,
) {
  return useExecuteGitHubAction(
    projectId,
    connection,
    refreshGitHubStatus,
    () => buildGitHubConfigRequest({
      githubStatus: null,
      selectedRepo: selection.selectedRepo,
      selectedBaseBranch: selection.selectedBaseBranch,
      pendingConfirmation: null,
    }),
  );
}

function useSyncGitHubAction(
  projectId: string,
  connection: ReturnType<typeof useConnectionState>,
  selection: ReturnType<typeof useSelectionState>,
  refreshGitHubStatus: () => Promise<void>,
) {
  return useExecuteGitHubAction(
    projectId,
    connection,
    refreshGitHubStatus,
    () => buildGitHubConfigRequest({
      githubStatus: connection.githubStatus,
      selectedRepo: selection.selectedRepo,
      selectedBaseBranch: selection.selectedBaseBranch,
      pendingConfirmation: null,
    }),
  );
}

function useConfirmGitHubAction(
  projectId: string,
  connection: ReturnType<typeof useConnectionState>,
  selection: ReturnType<typeof useSelectionState>,
  refreshGitHubStatus: () => Promise<void>,
) {
  return useExecuteGitHubAction(
    projectId,
    connection,
    refreshGitHubStatus,
    () => buildGitHubConfigRequest({
      githubStatus: connection.githubStatus,
      selectedRepo: selection.selectedRepo,
      selectedBaseBranch: selection.selectedBaseBranch,
      pendingConfirmation: connection.pendingRepositoryConfirmation,
    }),
  );
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
      connection.setPendingRepositoryConfirmation(null);
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
    pendingRepositoryConfirmation: connection.pendingRepositoryConfirmation,
    clearPendingRepositoryConfirmation: () => connection.setPendingRepositoryConfirmation(null),
    githubActionLabel: resolveGitHubConfigActionLabel(Boolean(connection.githubStatus?.connected)),
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
    handleSyncGitHub: actions.handleSyncGitHub,
    handleConfirmGitHubAction: actions.handleConfirmGitHubAction,
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
