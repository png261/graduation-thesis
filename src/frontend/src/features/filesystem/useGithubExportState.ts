import { useCallback, useEffect, useRef, useState } from "react";

import {
  connectProjectGitHub,
  createGitHubRepository,
  createProjectPullRequest,
  downloadProjectZip,
  getGitHubSession,
  getProjectGitHubStatus,
  listGitHubRepos,
  listProjectFiles,
  uploadProjectZip,
  type GitHubRepo,
  type GitHubSession,
  type ProjectGitHubStatus,
} from "../../api/projects/index";
import { useAuth } from "../../contexts/AuthContext";
import { toRepoName } from "./explorer/tree";

interface GithubExportParams {
  projectId: string;
  authenticated: boolean;
  fetchFiles: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  pushLog: (message: string) => void;
}

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function useCreateRepoState(projectId: string) {
  const [createRepoOpen, setCreateRepoOpen] = useState(false);
  const [createRepoName, setCreateRepoName] = useState(() => toRepoName(projectId));
  const [createRepoDescription, setCreateRepoDescription] = useState("");
  const [createRepoPrivate, setCreateRepoPrivate] = useState(true);
  const [createRepoBusy, setCreateRepoBusy] = useState(false);
  const [createRepoError, setCreateRepoError] = useState("");
  return { createRepoOpen, setCreateRepoOpen, createRepoName, setCreateRepoName, createRepoDescription, setCreateRepoDescription, createRepoPrivate, setCreateRepoPrivate, createRepoBusy, setCreateRepoBusy, createRepoError, setCreateRepoError };
}

function useImportRepoState() {
  const [importRepoOpen, setImportRepoOpen] = useState(false);
  const [importRepoLoading, setImportRepoLoading] = useState(false);
  const [importRepoBusy, setImportRepoBusy] = useState(false);
  const [importRepoError, setImportRepoError] = useState("");
  const [importRepoSession, setImportRepoSession] = useState<GitHubSession>({ authenticated: false });
  const [importRepoList, setImportRepoList] = useState<GitHubRepo[]>([]);
  const [importRepoName, setImportRepoName] = useState("");
  const [importBaseBranch, setImportBaseBranch] = useState("");
  return { importRepoOpen, setImportRepoOpen, importRepoLoading, setImportRepoLoading, importRepoBusy, setImportRepoBusy, importRepoError, setImportRepoError, importRepoSession, setImportRepoSession, importRepoList, setImportRepoList, importRepoName, setImportRepoName, importBaseBranch, setImportBaseBranch };
}

function useZipImportState() {
  const [zipImportBusy, setZipImportBusy] = useState(false);
  const [zipImportError, setZipImportError] = useState("");
  return { zipImportBusy, setZipImportBusy, zipImportError, setZipImportError };
}

function usePullRequestState() {
  const [prOpen, setPrOpen] = useState(false);
  const [prTitle, setPrTitle] = useState("chore: export code updates");
  const [prDescription, setPrDescription] = useState("");
  const [prBaseBranch, setPrBaseBranch] = useState("main");
  const [prBusy, setPrBusy] = useState(false);
  const [prError, setPrError] = useState("");
  return { prOpen, setPrOpen, prTitle, setPrTitle, prDescription, setPrDescription, prBaseBranch, setPrBaseBranch, prBusy, setPrBusy, prError, setPrError };
}

function useRefreshAndOpenFirstFile(projectId: string, fetchFiles: () => Promise<void>, openFile: (path: string) => Promise<void>) {
  return useCallback(async () => {
    const files = await listProjectFiles(projectId);
    await fetchFiles();
    const firstPath = files[0]?.path;
    if (firstPath) {
      await openFile(firstPath);
    }
  }, [fetchFiles, openFile, projectId]);
}

function useRefreshGitHubStatus(
  projectId: string,
  authenticated: boolean,
  setGithubStatus: (value: ProjectGitHubStatus | null) => void,
  setPrBaseBranch: (value: string | ((prev: string) => string)) => void,
) {
  return useCallback(async () => {
    if (!authenticated) {
      setGithubStatus(null);
      return;
    }
    try {
      const status = await getProjectGitHubStatus(projectId);
      setGithubStatus(status);
      if (status.base_branch) setPrBaseBranch(status.base_branch);
    } catch {
      setGithubStatus(null);
    }
  }, [authenticated, projectId, setGithubStatus, setPrBaseBranch]);
}

function useResetGitHubExportState(
  projectId: string,
  createRepo: ReturnType<typeof useCreateRepoState>,
  importRepo: ReturnType<typeof useImportRepoState>,
  zipImport: ReturnType<typeof useZipImportState>,
  pullRequest: ReturnType<typeof usePullRequestState>,
  setExportError: (value: string) => void,
) {
  return useCallback(() => {
    resetCreateRepoState(projectId, createRepo);
    resetImportRepoState(importRepo);
    resetZipImportState(zipImport);
    resetPullRequestState(pullRequest);
    setExportError("");
  }, [createRepo, importRepo, projectId, pullRequest, setExportError, zipImport]);
}

function resetCreateRepoState(projectId: string, createRepo: ReturnType<typeof useCreateRepoState>) {
  createRepo.setCreateRepoName(toRepoName(projectId));
  createRepo.setCreateRepoDescription("");
  createRepo.setCreateRepoPrivate(true);
  createRepo.setCreateRepoError("");
  createRepo.setCreateRepoOpen(false);
}

function resetImportRepoState(importRepo: ReturnType<typeof useImportRepoState>) {
  importRepo.setImportRepoOpen(false);
  importRepo.setImportRepoLoading(false);
  importRepo.setImportRepoBusy(false);
  importRepo.setImportRepoError("");
  importRepo.setImportRepoSession({ authenticated: false });
  importRepo.setImportRepoList([]);
  importRepo.setImportRepoName("");
  importRepo.setImportBaseBranch("");
}

function resetZipImportState(zipImport: ReturnType<typeof useZipImportState>) {
  zipImport.setZipImportBusy(false);
  zipImport.setZipImportError("");
}

function resetPullRequestState(pullRequest: ReturnType<typeof usePullRequestState>) {
  pullRequest.setPrOpen(false);
  pullRequest.setPrTitle("chore: export code updates");
  pullRequest.setPrDescription("");
  pullRequest.setPrError("");
}

function useInitialGitHubExportEffect(projectId: string, resetState: () => void, refreshGitHubStatus: () => Promise<void>) {
  useEffect(() => {
    resetState();
    void refreshGitHubStatus();
  }, [projectId, refreshGitHubStatus]);
}

function preferredImportRepo(currentName: string, repos: GitHubRepo[]): string {
  return repos.some((repo) => repo.full_name === currentName) ? currentName : (repos[0]?.full_name ?? "");
}

function preferredImportBaseBranch(repos: GitHubRepo[], repoName: string): string {
  return repos.find((repo) => repo.full_name === repoName)?.default_branch ?? "";
}

async function loadImportRepoData(
  importRepoName: string,
  importRepo: Pick<ReturnType<typeof useImportRepoState>,
    "setImportRepoLoading" | "setImportRepoError" | "setImportRepoSession" | "setImportRepoList" | "setImportRepoName" | "setImportBaseBranch"
  >,
  isCancelled: () => boolean,
) {
  importRepo.setImportRepoLoading(true);
  importRepo.setImportRepoError("");
  try {
    const session = await getGitHubSession();
    if (isCancelled()) return;
    importRepo.setImportRepoSession(session);
    if (!session.authenticated) {
      setUnauthenticatedImportState(importRepo);
      return;
    }
    const repos = await listGitHubRepos();
    if (isCancelled()) return;
    setLoadedImportRepos(importRepoName, repos, importRepo);
  } catch (error: unknown) {
    if (isCancelled()) return;
    importRepo.setImportRepoError(toErrorMessage(error, "Failed to load GitHub repositories"));
    importRepo.setImportRepoList([]);
  } finally {
    if (!isCancelled()) importRepo.setImportRepoLoading(false);
  }
}

function setUnauthenticatedImportState(
  importRepo: Pick<ReturnType<typeof useImportRepoState>, "setImportRepoList" | "setImportRepoName" | "setImportBaseBranch">,
) {
  importRepo.setImportRepoList([]);
  importRepo.setImportRepoName("");
  importRepo.setImportBaseBranch("");
}

function setLoadedImportRepos(
  importRepoName: string,
  repos: GitHubRepo[],
  importRepo: Pick<ReturnType<typeof useImportRepoState>, "setImportRepoList" | "setImportRepoName" | "setImportBaseBranch">,
) {
  importRepo.setImportRepoList(repos);
  const repoName = preferredImportRepo(importRepoName, repos);
  importRepo.setImportRepoName(repoName);
  const base = preferredImportBaseBranch(repos, repoName);
  importRepo.setImportBaseBranch((prev) => prev || base);
}

function useImportRepoLoader(
  importRepo: ReturnType<typeof useImportRepoState>,
  authenticated: boolean,
) {
  const cancelledRef = useRef(false);
  const {
    importRepoOpen,
    importRepoName,
    setImportRepoLoading,
    setImportRepoError,
    setImportRepoSession,
    setImportRepoList,
    setImportRepoName,
    setImportBaseBranch,
  } = importRepo;
  useEffect(() => {
    if (!importRepoOpen || !authenticated) return;
    cancelledRef.current = false;
    const isCancelled = () => cancelledRef.current;
    void loadImportRepoData(importRepoName, { setImportRepoLoading, setImportRepoError, setImportRepoSession, setImportRepoList, setImportRepoName, setImportBaseBranch }, isCancelled);
    return () => {
      cancelledRef.current = true;
    };
  }, [authenticated, importRepoName, importRepoOpen, setImportBaseBranch, setImportRepoError, setImportRepoList, setImportRepoLoading, setImportRepoName, setImportRepoSession]);
}

function requireAuthenticated(
  authenticated: boolean,
  setError: (value: string) => void,
  message: string,
): boolean {
  if (authenticated) return true;
  setError(message);
  return false;
}

function saveZipBlob(projectId: string, blob: Blob) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `${toRepoName(projectId)}.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

function useDownloadZipAction(
  projectId: string,
  authenticated: boolean,
  setExportError: (value: string) => void,
  pushLog: (message: string) => void,
) {
  return useCallback(async () => {
    if (!requireAuthenticated(authenticated, setExportError, "Login required to export code.")) return;
    setExportError("");
    try {
      const blob = await downloadProjectZip(projectId);
      saveZipBlob(projectId, blob);
      pushLog("Exported project as zip archive");
    } catch (error: unknown) {
      setExportError(toErrorMessage(error, "Failed to export zip"));
      pushLog("Zip export failed");
    }
  }, [authenticated, projectId, pushLog, setExportError]);
}

function useOpenCreateRepoDialogAction(authenticated: boolean, createRepo: ReturnType<typeof useCreateRepoState>) {
  return useCallback(() => {
    if (!requireAuthenticated(authenticated, createRepo.setCreateRepoError, "Login required to connect GitHub.")) return;
    createRepo.setCreateRepoError("");
    createRepo.setCreateRepoOpen(true);
  }, [authenticated, createRepo]);
}

function useOpenImportRepoDialogAction(authenticated: boolean, importRepo: ReturnType<typeof useImportRepoState>) {
  return useCallback(() => {
    if (!requireAuthenticated(authenticated, importRepo.setImportRepoError, "Login required to import from GitHub.")) return;
    importRepo.setImportRepoError("");
    importRepo.setImportRepoOpen(true);
  }, [authenticated, importRepo]);
}

function useImportRepoLoginAction(login: () => void) {
  return useCallback(() => {
    login();
  }, [login]);
}

function useImportFromGithubAction(
  projectId: string,
  authenticated: boolean,
  importRepo: ReturnType<typeof useImportRepoState>,
  refreshAndOpenFirstFile: () => Promise<void>,
  refreshGitHubStatus: () => Promise<void>,
  pushLog: (message: string) => void,
) {
  const importValidationError = () => getImportValidationError(authenticated, importRepo);
  return useCallback(async () => {
    const validationError = importValidationError();
    if (validationError) {
      importRepo.setImportRepoError(validationError);
      return;
    }
    importRepo.setImportRepoBusy(true);
    importRepo.setImportRepoError("");
    try {
      await connectProjectGitHub(projectId, importRepo.importRepoName, resolvedImportBaseBranch(importRepo));
      await finishImportRepository(importRepo.importRepoName, importRepo.setImportRepoOpen, refreshAndOpenFirstFile, refreshGitHubStatus, pushLog);
    } catch (error: unknown) {
      importRepo.setImportRepoError(toErrorMessage(error, "Failed to import repository"));
    } finally {
      importRepo.setImportRepoBusy(false);
    }
  }, [importValidationError, importRepo, projectId, pushLog, refreshAndOpenFirstFile, refreshGitHubStatus]);
}

function getImportValidationError(authenticated: boolean, importRepo: ReturnType<typeof useImportRepoState>): string | null {
  if (!authenticated) return "Login required to import from GitHub.";
  if (!importRepo.importRepoSession.authenticated) return "Login with GitHub before importing a repository.";
  if (!importRepo.importRepoName) return "Select a repository to import.";
  return null;
}

function resolvedImportBaseBranch(importRepo: ReturnType<typeof useImportRepoState>): string {
  const defaultBranch = importRepo.importRepoList.find((repo) => repo.full_name === importRepo.importRepoName)?.default_branch || "main";
  return importRepo.importBaseBranch.trim() || defaultBranch;
}

async function finishImportRepository(
  repoName: string,
  setImportRepoOpen: (value: boolean) => void,
  refreshAndOpenFirstFile: () => Promise<void>,
  refreshGitHubStatus: () => Promise<void>,
  pushLog: (message: string) => void,
) {
  await refreshAndOpenFirstFile();
  await refreshGitHubStatus();
  setImportRepoOpen(false);
  pushLog(`Imported repository ${repoName}`);
}

function useUploadZipAction(
  projectId: string,
  authenticated: boolean,
  zipImport: ReturnType<typeof useZipImportState>,
  refreshAndOpenFirstFile: () => Promise<void>,
  pushLog: (message: string) => void,
) {
  return useCallback(async (file: File) => {
    if (!requireAuthenticated(authenticated, zipImport.setZipImportError, "Login required to upload ZIP.")) return;
    if (!file.name.toLowerCase().endsWith(".zip")) {
      zipImport.setZipImportError("Please select a .zip file.");
      return;
    }
    zipImport.setZipImportBusy(true);
    zipImport.setZipImportError("");
    try {
      const result = await uploadProjectZip(projectId, file);
      await refreshAndOpenFirstFile();
      pushLog(`Imported ZIP archive (${result.imported_files} files)`);
    } catch (error: unknown) {
      zipImport.setZipImportError(toErrorMessage(error, "Failed to import ZIP"));
    } finally {
      zipImport.setZipImportBusy(false);
    }
  }, [authenticated, projectId, pushLog, refreshAndOpenFirstFile, zipImport]);
}

function useOpenPullRequestDialogAction(
  authenticated: boolean,
  githubStatus: ProjectGitHubStatus | null,
  setExportError: (value: string) => void,
  pullRequest: ReturnType<typeof usePullRequestState>,
) {
  return useCallback(() => {
    if (!requireAuthenticated(authenticated, setExportError, "Login required to create pull requests.")) return;
    pullRequest.setPrError("");
    pullRequest.setPrBaseBranch(githubStatus?.base_branch || "main");
    pullRequest.setPrOpen(true);
  }, [authenticated, githubStatus?.base_branch, pullRequest, setExportError]);
}

function createRepositoryValidationError(
  authenticated: boolean,
  githubConnected: boolean,
  repoName: string,
): string | null {
  if (!authenticated) return "Login required to connect GitHub.";
  if (!repoName.trim()) return "Repository name is required.";
  if (githubConnected) return "This project is already connected to a repository.";
  return null;
}

async function createAndConnectRepository(
  projectId: string,
  createRepo: ReturnType<typeof useCreateRepoState>,
  login: () => void,
): Promise<string | null> {
  const session = await getGitHubSession();
  if (!session.authenticated) {
    login();
    return null;
  }
  const repo = await createGitHubRepository(
    createRepo.createRepoName.trim(),
    createRepo.createRepoDescription.trim(),
    createRepo.createRepoPrivate,
  );
  await connectProjectGitHub(projectId, repo.full_name, repo.default_branch || "main");
  return repo.full_name;
}

function useCreateRepositoryAction(
  projectId: string,
  authenticated: boolean,
  githubStatus: ProjectGitHubStatus | null,
  createRepo: ReturnType<typeof useCreateRepoState>,
  refreshAndOpenFirstFile: () => Promise<void>,
  refreshGitHubStatus: () => Promise<void>,
  pushLog: (message: string) => void,
  login: () => void,
) {
  const validationError = createRepositoryValidationError(authenticated, Boolean(githubStatus?.connected), createRepo.createRepoName);
  return useCallback(async () => {
    if (validationError) {
      createRepo.setCreateRepoError(validationError);
      return;
    }
    createRepo.setCreateRepoBusy(true);
    createRepo.setCreateRepoError("");
    try {
      const repoName = await createAndConnectRepository(projectId, createRepo, login);
      if (!repoName) return;
      await finishCreateRepository(repoName, createRepo.setCreateRepoOpen, refreshAndOpenFirstFile, refreshGitHubStatus, pushLog);
    } catch (error: unknown) {
      createRepo.setCreateRepoError(toErrorMessage(error, "Failed to create GitHub repository"));
    } finally {
      createRepo.setCreateRepoBusy(false);
    }
  }, [createRepo, login, projectId, pushLog, refreshAndOpenFirstFile, refreshGitHubStatus, validationError]);
}

async function finishCreateRepository(
  repoName: string,
  setCreateRepoOpen: (value: boolean) => void,
  refreshAndOpenFirstFile: () => Promise<void>,
  refreshGitHubStatus: () => Promise<void>,
  pushLog: (message: string) => void,
) {
  await refreshAndOpenFirstFile();
  await refreshGitHubStatus();
  setCreateRepoOpen(false);
  pushLog(`Created and connected GitHub repo ${repoName}`);
}

function createPullRequestValidationError(
  authenticated: boolean,
  githubStatus: ProjectGitHubStatus | null,
  prTitle: string,
): string | null {
  if (!authenticated) return "Login required to create pull requests.";
  if (!githubStatus?.connected) return "Connect this project to a repository first.";
  if (!prTitle.trim()) return "Pull request title is required.";
  return null;
}

function useCreatePullRequestAction(
  projectId: string,
  authenticated: boolean,
  githubStatus: ProjectGitHubStatus | null,
  pullRequest: ReturnType<typeof usePullRequestState>,
  refreshGitHubStatus: () => Promise<void>,
  pushLog: (message: string) => void,
) {
  const validationError = createPullRequestValidationError(authenticated, githubStatus, pullRequest.prTitle);
  return useCallback(async () => {
    if (validationError) {
      pullRequest.setPrError(validationError);
      return;
    }
    pullRequest.setPrBusy(true);
    pullRequest.setPrError("");
    try {
      const baseBranch = pullRequest.prBaseBranch.trim() || githubStatus?.base_branch || "main";
      const result = await createProjectPullRequest(projectId, pullRequest.prTitle.trim(), pullRequest.prDescription, baseBranch);
      pullRequest.setPrOpen(false);
      await refreshGitHubStatus();
      pushLog(`Created pull request #${result.number}: ${result.url}`);
      if (result.url) window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (error: unknown) {
      pullRequest.setPrError(toErrorMessage(error, "Failed to create pull request"));
    } finally {
      pullRequest.setPrBusy(false);
    }
  }, [githubStatus, projectId, pullRequest, pushLog, refreshGitHubStatus, validationError]);
}

function createRepoPublicState(createRepo: ReturnType<typeof useCreateRepoState>) {
  return {
    createRepoOpen: createRepo.createRepoOpen,
    setCreateRepoOpen: createRepo.setCreateRepoOpen,
    createRepoName: createRepo.createRepoName,
    setCreateRepoName: createRepo.setCreateRepoName,
    createRepoDescription: createRepo.createRepoDescription,
    setCreateRepoDescription: createRepo.setCreateRepoDescription,
    createRepoPrivate: createRepo.createRepoPrivate,
    setCreateRepoPrivate: createRepo.setCreateRepoPrivate,
    createRepoBusy: createRepo.createRepoBusy,
    createRepoError: createRepo.createRepoError,
  };
}

function importRepoPublicState(importRepo: ReturnType<typeof useImportRepoState>, zipImport: ReturnType<typeof useZipImportState>) {
  return {
    importRepoOpen: importRepo.importRepoOpen,
    setImportRepoOpen: importRepo.setImportRepoOpen,
    importRepoLoading: importRepo.importRepoLoading,
    importRepoBusy: importRepo.importRepoBusy,
    importRepoError: importRepo.importRepoError,
    importRepoSession: importRepo.importRepoSession,
    importRepoList: importRepo.importRepoList,
    importRepoName: importRepo.importRepoName,
    setImportRepoName: importRepo.setImportRepoName,
    importBaseBranch: importRepo.importBaseBranch,
    setImportBaseBranch: importRepo.setImportBaseBranch,
    zipImportBusy: zipImport.zipImportBusy,
    zipImportError: zipImport.zipImportError,
  };
}

function pullRequestPublicState(pullRequest: ReturnType<typeof usePullRequestState>) {
  return {
    prOpen: pullRequest.prOpen,
    setPrOpen: pullRequest.setPrOpen,
    prTitle: pullRequest.prTitle,
    setPrTitle: pullRequest.setPrTitle,
    prDescription: pullRequest.prDescription,
    setPrDescription: pullRequest.setPrDescription,
    prBaseBranch: pullRequest.prBaseBranch,
    setPrBaseBranch: pullRequest.setPrBaseBranch,
    prBusy: pullRequest.prBusy,
    prError: pullRequest.prError,
  };
}

function useGithubExportActions(params: {
  projectId: string;
  authenticated: boolean;
  githubStatus: ProjectGitHubStatus | null;
  setExportError: (value: string) => void;
  createRepo: ReturnType<typeof useCreateRepoState>;
  importRepo: ReturnType<typeof useImportRepoState>;
  zipImport: ReturnType<typeof useZipImportState>;
  pullRequest: ReturnType<typeof usePullRequestState>;
  refreshAndOpenFirstFile: () => Promise<void>;
  refreshGitHubStatus: () => Promise<void>;
  pushLog: (message: string) => void;
  login: () => void;
}) {
  return {
    handleDownloadZip: useDownloadZipAction(params.projectId, params.authenticated, params.setExportError, params.pushLog),
    openCreateRepoDialog: useOpenCreateRepoDialogAction(params.authenticated, params.createRepo),
    openImportRepoDialog: useOpenImportRepoDialogAction(params.authenticated, params.importRepo),
    handleImportRepoLogin: useImportRepoLoginAction(params.login),
    handleImportFromGitHub: useImportFromGithubAction(params.projectId, params.authenticated, params.importRepo, params.refreshAndOpenFirstFile, params.refreshGitHubStatus, params.pushLog),
    handleUploadZip: useUploadZipAction(params.projectId, params.authenticated, params.zipImport, params.refreshAndOpenFirstFile, params.pushLog),
    openPullRequestDialog: useOpenPullRequestDialogAction(params.authenticated, params.githubStatus, params.setExportError, params.pullRequest),
    handleCreateGitHubRepository: useCreateRepositoryAction(params.projectId, params.authenticated, params.githubStatus, params.createRepo, params.refreshAndOpenFirstFile, params.refreshGitHubStatus, params.pushLog, params.login),
    handleCreatePullRequest: useCreatePullRequestAction(params.projectId, params.authenticated, params.githubStatus, params.pullRequest, params.refreshGitHubStatus, params.pushLog),
  };
}

function buildGithubExportResult(
  githubStatus: ProjectGitHubStatus | null,
  exportError: string,
  clearExportError: () => void,
  createRepo: ReturnType<typeof useCreateRepoState>,
  importRepo: ReturnType<typeof useImportRepoState>,
  zipImport: ReturnType<typeof useZipImportState>,
  pullRequest: ReturnType<typeof usePullRequestState>,
  actions: ReturnType<typeof useGithubExportActions>,
) {
  return {
    githubStatus,
    exportError,
    clearExportError,
    ...createRepoPublicState(createRepo),
    ...importRepoPublicState(importRepo, zipImport),
    ...pullRequestPublicState(pullRequest),
    ...actions,
  };
}

export function useGithubExportState({ projectId, authenticated, fetchFiles, openFile, pushLog }: GithubExportParams) {
  const { login } = useAuth();
  const [githubStatus, setGithubStatus] = useState<ProjectGitHubStatus | null>(null);
  const [exportError, setExportError] = useState("");
  const createRepo = useCreateRepoState(projectId);
  const importRepo = useImportRepoState();
  const zipImport = useZipImportState();
  const pullRequest = usePullRequestState();
  const refreshAndOpenFirstFile = useRefreshAndOpenFirstFile(projectId, fetchFiles, openFile);
  const refreshGitHubStatus = useRefreshGitHubStatus(projectId, authenticated, setGithubStatus, pullRequest.setPrBaseBranch);
  const resetState = useResetGitHubExportState(projectId, createRepo, importRepo, zipImport, pullRequest, setExportError);
  useInitialGitHubExportEffect(projectId, resetState, refreshGitHubStatus);
  useImportRepoLoader(importRepo, authenticated);
  const clearExportError = useCallback(() => setExportError(""), []);
  const actions = useGithubExportActions({ projectId, authenticated, githubStatus, setExportError, createRepo, importRepo, zipImport, pullRequest, refreshAndOpenFirstFile, refreshGitHubStatus, pushLog, login });
  return buildGithubExportResult(githubStatus, exportError, clearExportError, createRepo, importRepo, zipImport, pullRequest, actions);
}
