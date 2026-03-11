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

interface FilesystemPanelStateParams {
  projectId: string;
  authenticated: boolean;
}

function usePanelUiState(authenticated: boolean) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [newItemMode, setNewItemMode] = useState<"file" | "folder" | null>(null);
  const [activityLogs, setActivityLogs] = useState<string[]>([]);
  const [workspaceTab, setWorkspaceTab] = useState<"code" | "costs" | "graph">("code");
  const pushLog = useCallback((message: string) => {
    const stamp = new Date().toLocaleTimeString([], { hour12: false });
    setActivityLogs((prev) => [`[${stamp}] ${message}`, ...prev].slice(0, 300));
  }, []);
  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);
  return { isGuest: !authenticated, expandedFolders, setExpandedFolders, newItemMode, setNewItemMode, activityLogs, workspaceTab, setWorkspaceTab, pushLog, toggleFolder };
}

function useDerivedFilesystemState(files: ReturnType<typeof useFilesystem>["files"], selectedPath: string | null) {
  const tree = useMemo(() => buildTree(files), [files]);
  const language = selectedPath ? detectLanguage(selectedPath) : "plaintext";
  return { tree, language };
}

function buildPanelEffectsArgs(params: {
  authenticated: boolean;
  projectId: string;
  workspaceTab: "code" | "costs" | "graph";
  setWorkspaceTab: (tab: "code" | "costs" | "graph") => void;
  files: ReturnType<typeof useFilesystem>["files"];
  selectedPath: string | null;
  fetchFiles: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  pushLog: (message: string) => void;
  setExpandedFolders: React.Dispatch<React.SetStateAction<Set<string>>>;
  registerRefreshCallback: ReturnType<typeof useFilesystemContext>["registerRefreshCallback"];
  registerPolicyCheckCallback: ReturnType<typeof useFilesystemContext>["registerPolicyCheckCallback"];
  appendProblems: ReturnType<typeof useWorkflowRunner>["appendProblems"];
  resetWorkflow: ReturnType<typeof useWorkflowRunner>["resetWorkflow"];
  loadCosts: ReturnType<typeof useCostWorkspace>["loadCosts"];
  costScope: ReturnType<typeof useCostWorkspace>["costScope"];
  loadGraph: ReturnType<typeof useGraphWorkspace>["loadGraph"];
  graphScope: ReturnType<typeof useGraphWorkspace>["graphScope"];
}) {
  return params;
}

function buildPanelActionsArgs(params: {
  authenticated: boolean;
  files: ReturnType<typeof useFilesystem>["files"];
  selectedPath: ReturnType<typeof useFilesystem>["selectedPath"];
  content: ReturnType<typeof useFilesystem>["content"];
  deleteFile: ReturnType<typeof useFilesystem>["deleteFile"];
  createFile: ReturnType<typeof useFilesystem>["createFile"];
  saveFile: ReturnType<typeof useFilesystem>["saveFile"];
  openFile: ReturnType<typeof useFilesystem>["openFile"];
  fetchFiles: ReturnType<typeof useFilesystem>["fetchFiles"];
  setNewItemMode: (mode: "file" | "folder" | null) => void;
  clearExportError: ReturnType<typeof useGithubExportState>["clearExportError"];
  runWorkflow: ReturnType<typeof useWorkflowRunner>["handleRunWorkflow"];
  pushLog: (message: string) => void;
}) {
  return params;
}

function githubCreateRepoSection(github: ReturnType<typeof useGithubExportState>) {
  return {
    createRepoOpen: github.createRepoOpen,
    setCreateRepoOpen: github.setCreateRepoOpen,
    createRepoName: github.createRepoName,
    setCreateRepoName: github.setCreateRepoName,
    createRepoDescription: github.createRepoDescription,
    setCreateRepoDescription: github.setCreateRepoDescription,
    createRepoPrivate: github.createRepoPrivate,
    setCreateRepoPrivate: github.setCreateRepoPrivate,
    createRepoBusy: github.createRepoBusy,
    createRepoError: github.createRepoError,
  };
}

function githubImportSection(github: ReturnType<typeof useGithubExportState>) {
  return {
    importRepoOpen: github.importRepoOpen,
    setImportRepoOpen: github.setImportRepoOpen,
    importRepoLoading: github.importRepoLoading,
    importRepoBusy: github.importRepoBusy,
    importRepoError: github.importRepoError,
    importRepoSession: github.importRepoSession,
    importRepoList: github.importRepoList,
    importRepoName: github.importRepoName,
    setImportRepoName: github.setImportRepoName,
    importBaseBranch: github.importBaseBranch,
    setImportBaseBranch: github.setImportBaseBranch,
    zipImportBusy: github.zipImportBusy,
    zipImportError: github.zipImportError,
  };
}

function githubPullRequestSection(github: ReturnType<typeof useGithubExportState>) {
  return {
    prOpen: github.prOpen,
    setPrOpen: github.setPrOpen,
    prTitle: github.prTitle,
    setPrTitle: github.setPrTitle,
    prDescription: github.prDescription,
    setPrDescription: github.setPrDescription,
    prBaseBranch: github.prBaseBranch,
    setPrBaseBranch: github.setPrBaseBranch,
    prBusy: github.prBusy,
    prError: github.prError,
  };
}

function githubActionSection(github: ReturnType<typeof useGithubExportState>) {
  return {
    handleDownloadZip: github.handleDownloadZip,
    openCreateRepoDialog: github.openCreateRepoDialog,
    openImportRepoDialog: github.openImportRepoDialog,
    handleImportRepoLogin: github.handleImportRepoLogin,
    handleImportFromGitHub: github.handleImportFromGitHub,
    handleUploadZip: github.handleUploadZip,
    openPullRequestDialog: github.openPullRequestDialog,
    handleCreateGitHubRepository: github.handleCreateGitHubRepository,
    handleCreatePullRequest: github.handleCreatePullRequest,
  };
}

function workflowSection(workflow: ReturnType<typeof useWorkflowRunner>) {
  return {
    workflowTab: workflow.workflowTab,
    setWorkflowTab: workflow.setWorkflowTab,
    workflowProblems: workflow.workflowProblems,
    workflowBusy: workflow.workflowBusy,
    workflowError: workflow.workflowError,
  };
}

function costSection(costs: ReturnType<typeof useCostWorkspace>) {
  return {
    costScope: costs.costScope,
    setCostScope: costs.setCostScope,
    costData: costs.costData,
    costLoading: costs.costLoading,
    costError: costs.costError,
    costModules: costs.costModules,
    expandedCostResources: costs.expandedCostResources,
    refreshCosts: costs.refreshCosts,
    toggleCostResource: costs.toggleCostResource,
  };
}

function graphSection(graph: ReturnType<typeof useGraphWorkspace>) {
  return {
    graphScope: graph.graphScope,
    setGraphScope: graph.setGraphScope,
    graphViewMode: graph.graphViewMode,
    setGraphViewMode: graph.setGraphViewMode,
    graphData: graph.graphData,
    graphLoading: graph.graphLoading,
    graphStale: graph.graphStale,
    graphError: graph.graphError,
    graphModules: graph.graphModules,
    selectedGraphNodeId: graph.selectedGraphNodeId,
    setSelectedGraphNodeId: graph.setSelectedGraphNodeId,
    selectedGraphNode: graph.selectedGraphNode,
    refreshGraph: graph.refreshGraph,
  };
}

function buildFilesystemPanelResult(params: {
  authenticated: boolean;
  panel: ReturnType<typeof usePanelUiState>;
  filesystem: ReturnType<typeof useFilesystem>;
  derived: ReturnType<typeof useDerivedFilesystemState>;
  workflow: ReturnType<typeof useWorkflowRunner>;
  github: ReturnType<typeof useGithubExportState>;
  costs: ReturnType<typeof useCostWorkspace>;
  graph: ReturnType<typeof useGraphWorkspace>;
  actions: ReturnType<typeof useFilesystemPanelActions>;
}) {
  return {
    ...basePanelSection(params.authenticated, params.panel),
    ...filesystemDataSection(params.filesystem, params.panel, params.derived),
    githubStatus: params.github.githubStatus,
    exportError: params.github.exportError,
    ...workflowSection(params.workflow),
    ...githubCreateRepoSection(params.github),
    ...githubImportSection(params.github),
    ...githubPullRequestSection(params.github),
    ...costSection(params.costs),
    ...graphSection(params.graph),
    ...githubActionSection(params.github),
    ...filesystemActionSection(params.actions),
  };
}

function basePanelSection(authenticated: boolean, panel: ReturnType<typeof usePanelUiState>) {
  return {
    authenticated,
    isGuest: panel.isGuest,
    workspaceTab: panel.workspaceTab,
    setWorkspaceTab: panel.setWorkspaceTab,
    expandedFolders: panel.expandedFolders,
    toggleFolder: panel.toggleFolder,
    newItemMode: panel.newItemMode,
    setNewItemMode: panel.setNewItemMode,
    activityLogs: panel.activityLogs,
  };
}

function filesystemDataSection(
  filesystem: ReturnType<typeof useFilesystem>,
  panel: ReturnType<typeof usePanelUiState>,
  derived: ReturnType<typeof useDerivedFilesystemState>,
) {
  return {
    ...derived,
    selectedPath: filesystem.selectedPath,
    isDirty: filesystem.isDirty,
    isLoading: filesystem.isLoading,
    content: filesystem.content,
    setContent: filesystem.setContent,
    setNewItemMode: panel.setNewItemMode,
  };
}

function filesystemActionSection(actions: ReturnType<typeof useFilesystemPanelActions>) {
  return {
    handleDelete: actions.handleDelete,
    handleNewFile: actions.handleNewFile,
    handleNewFolder: actions.handleNewFolder,
    handleSave: actions.handleSave,
    handleOpenFile: actions.handleOpenFile,
    handleRefresh: actions.handleRefresh,
    handleRunWorkflow: actions.handleRunWorkflow,
  };
}

export function useFilesystemPanelState({ projectId, authenticated }: FilesystemPanelStateParams) {
  const filesystem = useFilesystem(projectId, { authenticated, readOnly: !authenticated });
  const context = useFilesystemContext();
  const panel = usePanelUiState(authenticated);
  const workflow = useWorkflowRunner({ projectId, authenticated, pushLog: panel.pushLog });
  const github = useGithubExportState({ projectId, authenticated, fetchFiles: filesystem.fetchFiles, openFile: filesystem.openFile, pushLog: panel.pushLog });
  const costs = useCostWorkspace(projectId, panel.pushLog);
  const graph = useGraphWorkspace(projectId, panel.pushLog);
  useFilesystemPanelEffects(buildPanelEffectsArgs({ authenticated, projectId, workspaceTab: panel.workspaceTab, setWorkspaceTab: panel.setWorkspaceTab, files: filesystem.files, selectedPath: filesystem.selectedPath, fetchFiles: filesystem.fetchFiles, openFile: filesystem.openFile, pushLog: panel.pushLog, setExpandedFolders: panel.setExpandedFolders, registerRefreshCallback: context.registerRefreshCallback, registerPolicyCheckCallback: context.registerPolicyCheckCallback, appendProblems: workflow.appendProblems, resetWorkflow: workflow.resetWorkflow, loadCosts: costs.loadCosts, costScope: costs.costScope, loadGraph: graph.loadGraph, graphScope: graph.graphScope }));
  const actions = useFilesystemPanelActions(buildPanelActionsArgs({ authenticated, files: filesystem.files, selectedPath: filesystem.selectedPath, content: filesystem.content, deleteFile: filesystem.deleteFile, createFile: filesystem.createFile, saveFile: filesystem.saveFile, openFile: filesystem.openFile, fetchFiles: filesystem.fetchFiles, setNewItemMode: panel.setNewItemMode, clearExportError: github.clearExportError, runWorkflow: workflow.handleRunWorkflow, pushLog: panel.pushLog }));
  const derived = useDerivedFilesystemState(filesystem.files, filesystem.selectedPath);
  return buildFilesystemPanelResult({ authenticated, panel, filesystem, derived, workflow, github, costs, graph, actions });
}
