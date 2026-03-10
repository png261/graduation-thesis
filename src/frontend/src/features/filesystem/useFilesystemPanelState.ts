import { useCallback, useMemo, useState } from "react";

import { useFilesystemContext } from "../../contexts/FilesystemContext";
import { useFilesystem } from "../../hooks/useFilesystem";
import { useCostWorkspace } from "./costs/useCostWorkspace";
import { buildTree, detectLanguage } from "./explorer/tree";
import { useGraphWorkspace } from "./graph/useGraphWorkspace";
import { useFilesystemPanelActions } from "./useFilesystemPanelActions";
import { useFilesystemPanelEffects } from "./useFilesystemPanelEffects";
import { useGithubExportState } from "./useGithubExportState";
import { useWorkflowRunner } from "./workflow/useWorkflowRunner";

export function useFilesystemPanelState({
  projectId,
  authenticated,
}: {
  projectId: string;
  authenticated: boolean;
}) {
  const {
    files,
    selectedPath,
    content,
    isDirty,
    isLoading,
    fetchFiles,
    openFile,
    saveFile,
    deleteFile,
    createFile,
    setContent,
  } = useFilesystem(projectId, { authenticated, readOnly: !authenticated });
  const { registerRefreshCallback, registerPolicyCheckCallback } = useFilesystemContext();

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [newItemMode, setNewItemMode] = useState<"file" | "folder" | null>(null);
  const [activityLogs, setActivityLogs] = useState<string[]>([]);
  const [workspaceTab, setWorkspaceTab] = useState<"code" | "costs" | "graph">("code");
  const isGuest = !authenticated;

  const pushLog = useCallback((message: string) => {
    const stamp = new Date().toLocaleTimeString([], { hour12: false });
    setActivityLogs((prev) => [`[${stamp}] ${message}`, ...prev].slice(0, 300));
  }, []);

  const {
    workflowBusy,
    workflowError,
    workflowTab,
    setWorkflowTab,
    workflowProblems,
    handleRunWorkflow: runWorkflow,
    appendProblems,
    resetWorkflow,
  } = useWorkflowRunner({ projectId, authenticated, pushLog });

  const {
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
    handleDownloadZip,
    openCreateRepoDialog,
    openImportRepoDialog,
    handleImportRepoLogin,
    handleImportFromGitHub,
    handleUploadZip,
    openPullRequestDialog,
    handleCreateGitHubRepository,
    handleCreatePullRequest,
  } = useGithubExportState({ projectId, authenticated, fetchFiles, openFile, pushLog });

  const {
    costScope,
    setCostScope,
    costData,
    costLoading,
    costError,
    costModules,
    expandedCostResources,
    loadCosts,
    refreshCosts,
    toggleCostResource,
  } = useCostWorkspace(projectId, pushLog);

  const {
    graphScope,
    setGraphScope,
    graphViewMode,
    setGraphViewMode,
    graphData,
    graphLoading,
    graphStale,
    graphError,
    graphModules,
    selectedGraphNodeId,
    setSelectedGraphNodeId,
    selectedGraphNode,
    loadGraph,
    refreshGraph,
  } = useGraphWorkspace(projectId, pushLog);

  useFilesystemPanelEffects({
    authenticated,
    projectId,
    workspaceTab,
    setWorkspaceTab,
    files,
    selectedPath,
    fetchFiles,
    openFile,
    pushLog,
    setExpandedFolders,
    registerRefreshCallback,
    registerPolicyCheckCallback,
    appendProblems,
    resetWorkflow,
    loadCosts,
    costScope,
    loadGraph,
    graphScope,
  });

  const actions = useFilesystemPanelActions({
    authenticated,
    files,
    selectedPath,
    content,
    deleteFile,
    createFile,
    saveFile,
    openFile,
    fetchFiles,
    setNewItemMode,
    clearExportError,
    runWorkflow,
    pushLog,
  });

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const tree = useMemo(() => buildTree(files), [files]);
  const language = selectedPath ? detectLanguage(selectedPath) : "plaintext";

  return {
    authenticated,
    isGuest,
    workspaceTab,
    setWorkspaceTab,

    tree,
    language,
    selectedPath,
    isDirty,
    isLoading,
    content,
    setContent,
    expandedFolders,
    toggleFolder,
    newItemMode,
    setNewItemMode,
    activityLogs,

    workflowTab,
    setWorkflowTab,
    workflowProblems,
    workflowBusy,
    workflowError,

    githubStatus,
    exportError,

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

    costScope,
    setCostScope,
    costData,
    costLoading,
    costError,
    costModules,
    expandedCostResources,
    refreshCosts,
    toggleCostResource,

    graphScope,
    setGraphScope,
    graphViewMode,
    setGraphViewMode,
    graphData,
    graphLoading,
    graphStale,
    graphError,
    graphModules,
    selectedGraphNodeId,
    setSelectedGraphNodeId,
    selectedGraphNode,
    refreshGraph,

    handleDelete: actions.handleDelete,
    handleNewFile: actions.handleNewFile,
    handleNewFolder: actions.handleNewFolder,
    handleSave: actions.handleSave,
    handleOpenFile: actions.handleOpenFile,
    handleRefresh: actions.handleRefresh,
    handleDownloadZip,
    openCreateRepoDialog,
    openImportRepoDialog,
    handleImportRepoLogin,
    handleImportFromGitHub,
    handleUploadZip,
    openPullRequestDialog,
    handleCreateGitHubRepository,
    handleCreatePullRequest,
    handleRunWorkflow: actions.handleRunWorkflow,
  };
}
