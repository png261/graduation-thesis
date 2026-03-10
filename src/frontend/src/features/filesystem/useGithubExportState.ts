import { useCallback, useEffect, useState } from "react";

import {
  connectProjectGitHub,
  createGitHubRepository,
  createProjectPullRequest,
  downloadProjectZip,
  getGitHubLoginUrl,
  getGitHubSession,
  getProjectGitHubStatus,
  listGitHubRepos,
  listProjectFiles,
  uploadProjectZip,
  type GitHubRepo,
  type GitHubSession,
  type ProjectGitHubStatus,
} from "../../api/projects/index";
import { toRepoName } from "./explorer/tree";

export function useGithubExportState({
  projectId,
  authenticated,
  fetchFiles,
  openFile,
  pushLog,
}: {
  projectId: string;
  authenticated: boolean;
  fetchFiles: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  pushLog: (message: string) => void;
}) {
  const [githubStatus, setGithubStatus] = useState<ProjectGitHubStatus | null>(null);

  const [createRepoOpen, setCreateRepoOpen] = useState(false);
  const [createRepoName, setCreateRepoName] = useState(() => toRepoName(projectId));
  const [createRepoDescription, setCreateRepoDescription] = useState("");
  const [createRepoPrivate, setCreateRepoPrivate] = useState(true);
  const [createRepoBusy, setCreateRepoBusy] = useState(false);
  const [createRepoError, setCreateRepoError] = useState("");

  const [importRepoOpen, setImportRepoOpen] = useState(false);
  const [importRepoLoading, setImportRepoLoading] = useState(false);
  const [importRepoBusy, setImportRepoBusy] = useState(false);
  const [importRepoError, setImportRepoError] = useState("");
  const [importRepoSession, setImportRepoSession] = useState<GitHubSession>({ authenticated: false });
  const [importRepoList, setImportRepoList] = useState<GitHubRepo[]>([]);
  const [importRepoName, setImportRepoName] = useState("");
  const [importBaseBranch, setImportBaseBranch] = useState("");

  const [zipImportBusy, setZipImportBusy] = useState(false);
  const [zipImportError, setZipImportError] = useState("");

  const [prOpen, setPrOpen] = useState(false);
  const [prTitle, setPrTitle] = useState("chore: export code updates");
  const [prDescription, setPrDescription] = useState("");
  const [prBaseBranch, setPrBaseBranch] = useState("main");
  const [prBusy, setPrBusy] = useState(false);
  const [prError, setPrError] = useState("");

  const [exportError, setExportError] = useState("");

  const refreshAndOpenFirstFile = useCallback(async () => {
    const files = await listProjectFiles(projectId);
    await fetchFiles();
    const firstPath = files[0]?.path;
    if (firstPath) {
      await openFile(firstPath);
    }
  }, [projectId, fetchFiles, openFile]);

  const refreshGitHubStatus = useCallback(async () => {
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
  }, [projectId, authenticated]);

  const resetGitHubExportState = useCallback(() => {
    setCreateRepoName(toRepoName(projectId));
    setCreateRepoDescription("");
    setCreateRepoPrivate(true);
    setCreateRepoError("");
    setCreateRepoOpen(false);

    setImportRepoOpen(false);
    setImportRepoLoading(false);
    setImportRepoBusy(false);
    setImportRepoError("");
    setImportRepoSession({ authenticated: false });
    setImportRepoList([]);
    setImportRepoName("");
    setImportBaseBranch("");

    setZipImportBusy(false);
    setZipImportError("");

    setPrOpen(false);
    setPrTitle("chore: export code updates");
    setPrDescription("");
    setPrError("");
    setExportError("");
  }, [projectId]);

  useEffect(() => {
    resetGitHubExportState();
    void refreshGitHubStatus();
  }, [refreshGitHubStatus, resetGitHubExportState]);

  useEffect(() => {
    if (!importRepoOpen || !authenticated) return;
    let cancelled = false;

    const load = async () => {
      setImportRepoLoading(true);
      setImportRepoError("");
      try {
        const session = await getGitHubSession();
        if (cancelled) return;
        setImportRepoSession(session);
        if (!session.authenticated) {
          setImportRepoList([]);
          setImportRepoName("");
          setImportBaseBranch("");
          return;
        }

        const repos = await listGitHubRepos();
        if (cancelled) return;
        setImportRepoList(repos);
        const preferredRepo = repos.some((repo) => repo.full_name === importRepoName)
          ? importRepoName
          : (repos[0]?.full_name ?? "");
        setImportRepoName(preferredRepo);
        const preferredBase = repos.find((repo) => repo.full_name === preferredRepo)?.default_branch ?? "";
        setImportBaseBranch((prev) => prev || preferredBase);
      } catch (error: unknown) {
        if (!cancelled) {
          setImportRepoError(error instanceof Error ? error.message : "Failed to load GitHub repositories");
          setImportRepoList([]);
        }
      } finally {
        if (!cancelled) setImportRepoLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [importRepoOpen, authenticated, importRepoName]);

  const clearExportError = useCallback(() => {
    setExportError("");
  }, []);

  const handleDownloadZip = useCallback(async () => {
    if (!authenticated) {
      setExportError("Login required to export code.");
      return;
    }
    setExportError("");
    try {
      const blob = await downloadProjectZip(projectId);
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `${toRepoName(projectId)}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
      pushLog("Exported project as zip archive");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to export zip";
      setExportError(message);
      pushLog("Zip export failed");
    }
  }, [projectId, pushLog, authenticated]);

  const openCreateRepoDialog = useCallback(() => {
    if (!authenticated) {
      setExportError("Login required to connect GitHub.");
      return;
    }
    setCreateRepoError("");
    setCreateRepoOpen(true);
  }, [authenticated]);

  const openImportRepoDialog = useCallback(() => {
    if (!authenticated) {
      setImportRepoError("Login required to import from GitHub.");
      return;
    }
    setImportRepoError("");
    setImportRepoOpen(true);
  }, [authenticated]);

  const handleImportRepoLogin = useCallback(() => {
    window.location.href = getGitHubLoginUrl();
  }, []);

  const handleImportFromGitHub = useCallback(async () => {
    if (!authenticated) {
      setImportRepoError("Login required to import from GitHub.");
      return;
    }
    if (!importRepoSession.authenticated) {
      setImportRepoError("Login with GitHub before importing a repository.");
      return;
    }
    if (!importRepoName) {
      setImportRepoError("Select a repository to import.");
      return;
    }

    setImportRepoBusy(true);
    setImportRepoError("");
    try {
      const defaultBranch = importRepoList.find((repo) => repo.full_name === importRepoName)?.default_branch || "main";
      await connectProjectGitHub(
        projectId,
        importRepoName,
        importBaseBranch.trim() || defaultBranch,
      );
      await refreshAndOpenFirstFile();
      await refreshGitHubStatus();
      setImportRepoOpen(false);
      pushLog(`Imported repository ${importRepoName}`);
    } catch (error: unknown) {
      setImportRepoError(error instanceof Error ? error.message : "Failed to import repository");
    } finally {
      setImportRepoBusy(false);
    }
  }, [
    authenticated,
    importRepoSession.authenticated,
    importRepoName,
    importRepoList,
    importBaseBranch,
    projectId,
    refreshAndOpenFirstFile,
    refreshGitHubStatus,
    pushLog,
  ]);

  const handleUploadZip = useCallback(async (file: File) => {
    if (!authenticated) {
      setZipImportError("Login required to upload ZIP.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setZipImportError("Please select a .zip file.");
      return;
    }

    setZipImportBusy(true);
    setZipImportError("");
    try {
      const result = await uploadProjectZip(projectId, file);
      await refreshAndOpenFirstFile();
      pushLog(`Imported ZIP archive (${result.imported_files} files)`);
    } catch (error: unknown) {
      setZipImportError(error instanceof Error ? error.message : "Failed to import ZIP");
    } finally {
      setZipImportBusy(false);
    }
  }, [authenticated, projectId, refreshAndOpenFirstFile, pushLog]);

  const openPullRequestDialog = useCallback(() => {
    if (!authenticated) {
      setExportError("Login required to create pull requests.");
      return;
    }
    setPrError("");
    setPrBaseBranch(githubStatus?.base_branch || "main");
    setPrOpen(true);
  }, [authenticated, githubStatus?.base_branch]);

  const handleCreateGitHubRepository = useCallback(async () => {
    if (!authenticated) {
      setCreateRepoError("Login required to connect GitHub.");
      return;
    }
    if (!createRepoName.trim()) {
      setCreateRepoError("Repository name is required.");
      return;
    }
    if (githubStatus?.connected) {
      setCreateRepoError("This project is already connected to a repository.");
      return;
    }

    setCreateRepoBusy(true);
    setCreateRepoError("");
    try {
      const session = await getGitHubSession();
      if (!session.authenticated) {
        window.location.href = getGitHubLoginUrl();
        return;
      }

      const repo = await createGitHubRepository(
        createRepoName.trim(),
        createRepoDescription.trim(),
        createRepoPrivate,
      );
      await connectProjectGitHub(projectId, repo.full_name, repo.default_branch || "main");
      await refreshAndOpenFirstFile();
      await refreshGitHubStatus();
      setCreateRepoOpen(false);
      pushLog(`Created and connected GitHub repo ${repo.full_name}`);
    } catch (error: unknown) {
      setCreateRepoError(error instanceof Error ? error.message : "Failed to create GitHub repository");
    } finally {
      setCreateRepoBusy(false);
    }
  }, [
    createRepoName,
    createRepoDescription,
    createRepoPrivate,
    authenticated,
    githubStatus?.connected,
    projectId,
    refreshAndOpenFirstFile,
    refreshGitHubStatus,
    pushLog,
  ]);

  const handleCreatePullRequest = useCallback(async () => {
    if (!authenticated) {
      setPrError("Login required to create pull requests.");
      return;
    }
    if (!githubStatus?.connected) {
      setPrError("Connect this project to a repository first.");
      return;
    }
    if (!prTitle.trim()) {
      setPrError("Pull request title is required.");
      return;
    }

    setPrBusy(true);
    setPrError("");
    try {
      const result = await createProjectPullRequest(
        projectId,
        prTitle.trim(),
        prDescription,
        prBaseBranch.trim() || githubStatus.base_branch || "main",
      );
      setPrOpen(false);
      await refreshGitHubStatus();
      pushLog(`Created pull request #${result.number}: ${result.url}`);
      if (result.url) window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (error: unknown) {
      setPrError(error instanceof Error ? error.message : "Failed to create pull request");
    } finally {
      setPrBusy(false);
    }
  }, [
    authenticated,
    githubStatus,
    prTitle,
    prDescription,
    prBaseBranch,
    projectId,
    refreshGitHubStatus,
    pushLog,
  ]);

  return {
    githubStatus,
    exportError,
    clearExportError,

    createRepoOpen,
    setCreateRepoOpen,
    createRepoName,
    setCreateRepoName,
    createRepoDescription,
    setCreateRepoDescription,
    createRepoPrivate,
    setCreateRepoPrivate,
    createRepoBusy,
    createRepoError,

    importRepoOpen,
    setImportRepoOpen,
    importRepoLoading,
    importRepoBusy,
    importRepoError,
    importRepoSession,
    importRepoList,
    importRepoName,
    setImportRepoName,
    importBaseBranch,
    setImportBaseBranch,
    zipImportBusy,
    zipImportError,

    prOpen,
    setPrOpen,
    prTitle,
    setPrTitle,
    prDescription,
    setPrDescription,
    prBaseBranch,
    setPrBaseBranch,
    prBusy,
    prError,

    handleDownloadZip,
    openCreateRepoDialog,
    openImportRepoDialog,
    handleImportRepoLogin,
    handleImportFromGitHub,
    handleUploadZip,
    openPullRequestDialog,
    handleCreateGitHubRepository,
    handleCreatePullRequest,
  };
}
