import { Code2, DollarSign, GitBranch } from "lucide-react";

import { CostsWorkspace, CreatePullRequestDialog, CreateRepoDialog, EditorPane, ExplorerPanel, GraphWorkspace, ImportRepoDialog, WorkflowTabsPanel, useFilesystemPanelState } from "../features/filesystem";
import { cn } from "../lib/utils";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./ui/resizable";

interface FilesystemPanelProps {
  projectId: string;
  authenticated: boolean;
}

type FilesystemPanelState = ReturnType<typeof useFilesystemPanelState>;

const WORKSPACE_TABS = [
  ["code", "Code", Code2],
  ["costs", "Costs", DollarSign],
  ["graph", "Graph", GitBranch],
] as const;

function WorkspaceTabSelector({ state }: { state: FilesystemPanelState }) {
  return (
    <div className="border-b border-[var(--da-border)] px-3 py-2">
      <div className="inline-flex rounded-lg border border-[var(--da-border)] bg-[var(--da-elevated)] p-1">
        {WORKSPACE_TABS.map(([value, label, Icon]) => (
          <button key={value} type="button" disabled={state.isGuest && value !== "code"} onClick={() => state.setWorkspaceTab(value)} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium", state.workspaceTab === value ? "bg-[var(--da-panel)] text-[var(--da-text)]" : "text-[var(--da-muted)] hover:text-[var(--da-text)]", state.isGuest && value !== "code" && "cursor-not-allowed opacity-40")}>
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function useFilesystemPanelActions(state: FilesystemPanelState) {
  return {
    onOpenFile: (path: string) => void state.handleOpenFile(path),
    onDelete: (path: string, isFolder: boolean) => void state.handleDelete(path, isFolder),
    onRefresh: () => void state.handleRefresh(),
    onNewFile: (name: string) => void state.handleNewFile(name),
    onNewFolder: (name: string) => void state.handleNewFolder(name),
    onUploadZip: (file: File) => void state.handleUploadZip(file),
    onRunWorkflow: (mode: "plan" | "apply") => void state.handleRunWorkflow(mode),
    onSave: () => void state.handleSave(),
    onDownloadZip: () => void state.handleDownloadZip(),
    onRefreshCosts: () => void state.refreshCosts(),
    onRefreshGraph: () => void state.refreshGraph(),
    onCreateRepo: () => void state.handleCreateGitHubRepository(),
    onCreatePullRequest: () => void state.handleCreatePullRequest(),
    onImportFromGithub: () => void state.handleImportFromGitHub(),
  };
}

function CodeWorkspaceView({ state, actions }: { state: FilesystemPanelState; actions: ReturnType<typeof useFilesystemPanelActions> }) {
  return (
    <ResizablePanelGroup direction="horizontal" className="h-full w-full">
      <ResizablePanel defaultSize={22} minSize={14} maxSize={40}>
        <ExplorerPanel tree={state.tree} selectedPath={state.selectedPath} readOnly={state.isGuest} expandedFolders={state.expandedFolders} toggleFolder={state.toggleFolder} onOpenFile={actions.onOpenFile} onDelete={actions.onDelete} onRefresh={actions.onRefresh} newItemMode={state.newItemMode} setNewItemMode={state.setNewItemMode} onNewFile={actions.onNewFile} onNewFolder={actions.onNewFolder} onOpenImportGitHub={state.openImportRepoDialog} onUploadZip={actions.onUploadZip} importBusy={state.importRepoBusy || state.zipImportBusy} importError={state.importRepoError || state.zipImportError} />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel minSize={45} className="min-w-0">
        <CodeEditorWorkflowSplit state={state} actions={actions} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function CodeEditorWorkflowSplit({ state, actions }: { state: FilesystemPanelState; actions: ReturnType<typeof useFilesystemPanelActions> }) {
  return (
    <ResizablePanelGroup direction="vertical" className="h-full">
      <ResizablePanel defaultSize={78} minSize={40}>
        <EditorPane selectedPath={state.selectedPath} readOnly={state.isGuest} isDirty={state.isDirty} isLoading={state.isLoading} language={state.language} content={state.content} setContent={state.setContent} exportError={state.exportError} workflowError={state.workflowError} githubStatus={state.githubStatus} workflowBusy={state.workflowBusy} onDownloadZip={actions.onDownloadZip} onOpenCreateRepo={state.openCreateRepoDialog} onOpenPullRequest={state.openPullRequestDialog} onRunWorkflow={actions.onRunWorkflow} onSave={actions.onSave} />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={22} minSize={12} maxSize={45}>
        <WorkflowTabsPanel workflowTab={state.workflowTab} setWorkflowTab={state.setWorkflowTab} activityLogs={state.activityLogs} workflowProblems={state.workflowProblems} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function CostsWorkspaceView({ state, actions }: { state: FilesystemPanelState; actions: ReturnType<typeof useFilesystemPanelActions> }) {
  return <CostsWorkspace data={state.costData} loading={state.costLoading} error={state.costError} scope={state.costScope} onScopeChange={state.setCostScope} onRefresh={actions.onRefreshCosts} expandedResourceIds={state.expandedCostResources} onToggleResource={state.toggleCostResource} />;
}

function GraphWorkspaceView({ state, actions }: { state: FilesystemPanelState; actions: ReturnType<typeof useFilesystemPanelActions> }) {
  return <GraphWorkspace data={state.graphData} loading={state.graphLoading} error={state.graphError} scope={state.graphScope} onScopeChange={state.setGraphScope} mode={state.graphViewMode} onModeChange={state.setGraphViewMode} modules={state.graphModules} stale={state.graphStale} selectedNodeId={state.selectedGraphNodeId} onSelectedNodeIdChange={state.setSelectedGraphNodeId} selectedNode={state.selectedGraphNode} onRefresh={actions.onRefreshGraph} />;
}

function WorkspaceContent({ state, actions }: { state: FilesystemPanelState; actions: ReturnType<typeof useFilesystemPanelActions> }) {
  if (state.workspaceTab === "code") return <CodeWorkspaceView state={state} actions={actions} />;
  if (state.workspaceTab === "costs") return <CostsWorkspaceView state={state} actions={actions} />;
  return <GraphWorkspaceView state={state} actions={actions} />;
}

function FilesystemDialogs({ state, actions }: { state: FilesystemPanelState; actions: ReturnType<typeof useFilesystemPanelActions> }) {
  return (
    <>
      <CreateRepoDialog open={state.createRepoOpen} onOpenChange={state.setCreateRepoOpen} name={state.createRepoName} onNameChange={state.setCreateRepoName} description={state.createRepoDescription} onDescriptionChange={state.setCreateRepoDescription} isPrivate={state.createRepoPrivate} onPrivateChange={state.setCreateRepoPrivate} busy={state.createRepoBusy} error={state.createRepoError} onSubmit={actions.onCreateRepo} />
      <CreatePullRequestDialog open={state.prOpen} onOpenChange={state.setPrOpen} title={state.prTitle} onTitleChange={state.setPrTitle} baseBranch={state.prBaseBranch} onBaseBranchChange={state.setPrBaseBranch} description={state.prDescription} onDescriptionChange={state.setPrDescription} error={state.prError} busy={state.prBusy} onSubmit={actions.onCreatePullRequest} githubConnected={Boolean(state.githubStatus?.connected)} placeholderBase={state.githubStatus?.base_branch || "main"} />
      <ImportRepoDialog open={state.importRepoOpen} onOpenChange={state.setImportRepoOpen} loading={state.importRepoLoading} busy={state.importRepoBusy} error={state.importRepoError} session={state.importRepoSession} repos={state.importRepoList} repoName={state.importRepoName} onRepoNameChange={state.setImportRepoName} baseBranch={state.importBaseBranch} onBaseBranchChange={state.setImportBaseBranch} onLogin={state.handleImportRepoLogin} onSubmit={actions.onImportFromGithub} />
    </>
  );
}

export function FilesystemPanel({ projectId, authenticated }: FilesystemPanelProps) {
  const state = useFilesystemPanelState({ projectId, authenticated });
  const actions = useFilesystemPanelActions(state);
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden border-l border-[var(--da-border)] bg-[var(--da-panel)]">
      <WorkspaceTabSelector state={state} />
      <div className="min-h-0 flex-1"><WorkspaceContent state={state} actions={actions} /></div>
      <FilesystemDialogs state={state} actions={actions} />
    </div>
  );
}
