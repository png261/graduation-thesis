import { Check, Code2, Copy, DollarSign, GitBranch } from "lucide-react";
import { useEffect, useState } from "react";

import {
  CostsWorkspaceMainPanel,
  CostsWorkspaceSidebarPanel,
  CreatePullRequestDialog,
  CreateRepoDialog,
  EditorPane,
  ExplorerPanel,
  GraphSidebar,
  GraphWorkspaceMainPanel,
  ImportRepoDialog,
  JobsWorkspaceMainPanel,
  JobsWorkspaceSidebarPanel,
  StateBackendsConnectDialog,
  StateBackendsMainPanel,
  StateBackendsSidebarPanel,
  useFilesystemPanelState,
} from "../features/filesystem";
import { cn } from "../lib/utils";

export type FilesystemPanelState = ReturnType<typeof useFilesystemPanelState>;

export interface FilesystemPanelActions {
  onOpenFile: (path: string) => void;
  onDelete: (path: string, isFolder: boolean) => void;
  onSelectionChange: (paths: string[]) => void;
  onMove: (sourcePaths: string[], destinationDir: string) => void;
  onRename: (path: string, newName: string) => void;
  onRefresh: () => void;
  onNewFile: (name: string) => void;
  onNewFolder: (name: string) => void;
  onUploadZip: (file: File) => void;
  onRunWorkflow: (mode: "plan" | "apply" | "pipeline") => void;
  onDownloadZip: () => void;
  onRefreshCosts: () => void;
  onRefreshGraph: () => void;
  onCreateRepo: () => void;
  onCreatePullRequest: () => void;
  onImportFromGithub: () => void;
}

interface FilesystemPanelProps {
  projectId: string;
  state: FilesystemPanelState;
  actions: FilesystemPanelActions;
}

const WORKSPACE_TABS = [
  ["code", "Code", Code2],
  ["costs", "Costs", DollarSign],
  ["graph", "Graph", GitBranch],
] as const;

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "avif"]);

function extensionFromPath(path: string): string {
  const name = path.split("/").pop() ?? path;
  const index = name.lastIndexOf(".");
  if (index < 0 || index === name.length - 1) return "";
  return name.slice(index + 1).toLowerCase();
}

function isCopyableFile(path: string | null) {
  if (!path) return false;
  return !IMAGE_EXTENSIONS.has(extensionFromPath(path));
}

export function createFilesystemPanelActions(state: FilesystemPanelState): FilesystemPanelActions {
  return {
    onOpenFile: (path: string) => void state.handleOpenFile(path),
    onDelete: (path: string, isFolder: boolean) => void state.handleDelete(path, isFolder),
    onSelectionChange: (paths: string[]) => void state.handleSelectionChange(paths),
    onMove: (sourcePaths: string[], destinationDir: string) => void state.handleMove(sourcePaths, destinationDir),
    onRename: (path: string, newName: string) => void state.handleRename(path, newName),
    onRefresh: () => void state.handleRefresh(),
    onNewFile: (name: string) => void state.handleNewFile(name),
    onNewFolder: (name: string) => void state.handleNewFolder(name),
    onUploadZip: (file: File) => void state.handleUploadZip(file),
    onRunWorkflow: (mode: "plan" | "apply" | "pipeline") => void state.handleRunWorkflow(mode),
    onDownloadZip: () => void state.handleDownloadZip(),
    onRefreshCosts: () => void state.refreshCosts(),
    onRefreshGraph: () => void state.refreshGraph(),
    onCreateRepo: () => void state.handleCreateGitHubRepository(),
    onCreatePullRequest: () => void state.handleCreatePullRequest(),
    onImportFromGithub: () => void state.handleImportFromGitHub(),
  };
}

function SidebarTabSelector({ state }: { state: FilesystemPanelState }) {
  return (
    <div className="border-b border-[var(--da-border)] px-3 py-3">
      <div className="grid grid-cols-3 gap-2">
        {WORKSPACE_TABS.map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            disabled={state.isGuest && value !== "code"}
            onClick={() => state.setWorkspaceTab(value)}
            className={cn(
              "inline-flex h-12 items-center justify-center gap-2 rounded-lg border text-base font-semibold",
              state.workspaceTab === value ? "border-white/30 bg-white/[0.08] text-white" : "border-transparent bg-transparent text-white/75 hover:bg-white/[0.05] hover:text-white",
              state.isGuest && value !== "code" && "cursor-not-allowed opacity-40",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function CodeSidebar({ state, actions }: { state: FilesystemPanelState; actions: FilesystemPanelActions }) {
  return (
    <ExplorerPanel tree={state.tree} selectedPath={state.selectedPath} selectedPaths={state.selectedPaths} readOnly={state.isGuest} expandedFolders={state.expandedFolders} toggleFolder={state.toggleFolder} onOpenFile={actions.onOpenFile} onSelectionChange={actions.onSelectionChange} onMovePaths={actions.onMove} onRenamePath={actions.onRename} onDelete={actions.onDelete} onRefresh={actions.onRefresh} newItemMode={state.newItemMode} setNewItemMode={state.setNewItemMode} onNewFile={actions.onNewFile} onNewFolder={actions.onNewFolder} onOpenImportGitHub={state.openImportRepoDialog} onUploadZip={actions.onUploadZip} importBusy={state.importRepoBusy || state.zipImportBusy} importError={state.importRepoError || state.zipImportError} />
  );
}

function CostsSidebar({ state }: { state: FilesystemPanelState }) {
  return <CostsWorkspaceSidebarPanel data={state.costData} scope={state.costScope} onScopeChange={state.setCostScope} className="h-full overflow-y-auto" />;
}

function GraphSidebarView({ state, actions }: { state: FilesystemPanelState; actions: FilesystemPanelActions }) {
  return <GraphSidebar modules={state.graphModules} scope={state.graphScope} loading={state.graphLoading} onScopeChange={state.setGraphScope} onRefresh={actions.onRefreshGraph} className="h-full w-full border-r-0" />;
}

function JobsSidebar({ state }: { state: FilesystemPanelState }) {
  return (
    <JobsWorkspaceSidebarPanel
      jobs={state.jobs}
      loading={state.jobsLoading}
      error={state.jobsError}
      statusFilter={state.jobsStatusFilter}
      kindFilter={state.jobsKindFilter}
      selectedJobId={state.selectedJobId}
      onStatusFilter={state.setJobsStatusFilter}
      onKindFilter={state.setJobsKindFilter}
      onSelectJob={state.setSelectedJobId}
      onRefresh={state.refreshJobs}
    />
  );
}

function StateBackendsSidebar({ state }: { state: FilesystemPanelState }) {
  return (
    <StateBackendsSidebarPanel
      backends={state.stateBackends}
      loading={state.stateBackendsLoading}
      error={state.stateBackendsError}
      selectedBackendId={state.selectedStateBackendId}
      onSelectBackend={state.setSelectedStateBackendId}
      onRefresh={state.refreshStateBackends}
      onOpenConnect={() => state.setStateConnectOpen(true)}
    />
  );
}

function WorkspaceSidebarContent({ state, actions }: { state: FilesystemPanelState; actions: FilesystemPanelActions }) {
  if (state.workspaceTab === "code") return <CodeSidebar state={state} actions={actions} />;
  if (state.workspaceTab === "costs") return <CostsSidebar state={state} />;
  if (state.workspaceTab === "graph") return <GraphSidebarView state={state} actions={actions} />;
  if (state.workspaceTab === "state") return <StateBackendsSidebar state={state} />;
  return <JobsSidebar state={state} />;
}

function CodeMainToolbar({ selectedPath, content, isLoading }: { selectedPath: string | null; content: string; isLoading: boolean }) {
  const [copied, setCopied] = useState(false);
  const canCopy = Boolean(!isLoading && content && isCopyableFile(selectedPath));

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    if (!canCopy) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex h-14 items-center justify-between gap-3 border-b border-[var(--da-border)] bg-[#0c1018] px-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="truncate font-mono text-lg text-white/85">{selectedPath || "No file selected"}</span>
        <span className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-sm font-medium text-white/75">v0.0.1</span>
      </div>
      <button type="button" onClick={() => void handleCopy()} disabled={!canCopy} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold", canCopy ? "text-white hover:bg-white/[0.06]" : "cursor-not-allowed text-white/35")}>
        {copied ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
        {copied ? "Copied" : "Copy code"}
      </button>
    </div>
  );
}

function CodeMainView({ state, projectId }: { state: FilesystemPanelState; projectId: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0a0e15]">
      <CodeMainToolbar selectedPath={state.selectedPath} content={state.content} isLoading={state.isLoading} />
      <div className="min-h-0 flex-1">
        <EditorPane projectId={projectId} selectedPath={state.selectedPath} readOnly={state.isGuest} isLoading={state.isLoading} language={state.language} content={state.content} setContent={state.setContent} exportError={state.exportError} workflowError={state.workflowError} />
      </div>
    </div>
  );
}

function CostsMainView({ state, actions }: { state: FilesystemPanelState; actions: FilesystemPanelActions }) {
  return <CostsWorkspaceMainPanel data={state.costData} loading={state.costLoading} error={state.costError} onRefresh={actions.onRefreshCosts} expandedResourceIds={state.expandedCostResources} onToggleResource={state.toggleCostResource} />;
}

function GraphMainView({ state }: { state: FilesystemPanelState }) {
  return <GraphWorkspaceMainPanel data={state.graphData} loading={state.graphLoading} error={state.graphError} scope={state.graphScope} mode={state.graphViewMode} onModeChange={state.setGraphViewMode} modules={state.graphModules} stale={state.graphStale} selectedNodeId={state.selectedGraphNodeId} onSelectedNodeIdChange={state.setSelectedGraphNodeId} selectedNode={state.selectedGraphNode} />;
}

function JobsMainView({ state }: { state: FilesystemPanelState }) {
  return (
    <JobsWorkspaceMainPanel
      selectedJob={state.selectedJob}
      selectedSummary={state.selectedJobSummary}
      events={state.selectedJobEvents}
      streaming={state.jobsStreaming}
      onCancel={state.cancelSelectedJob}
      onRerun={state.rerunSelectedJob}
    />
  );
}

function StateBackendsMainView({ state }: { state: FilesystemPanelState }) {
  return (
    <StateBackendsMainPanel
      backend={state.selectedStateBackend}
      activeTab={state.stateBackendTab}
      onTabChange={state.setStateBackendTab}
      loading={state.stateDetailsLoading}
      error={state.stateDetailsError}
      search={state.stateSearch}
      onSearch={state.setStateSearch}
      activeOnly={state.stateActiveOnly}
      onActiveOnly={state.setStateActiveOnly}
      showSensitive={state.stateShowSensitive}
      onShowSensitive={state.setStateShowSensitive}
      resources={state.stateResources}
      history={state.stateHistory}
      driftAlerts={state.stateDriftAlerts}
      policyAlerts={state.statePolicyAlerts}
      settingsPayload={state.stateSettingsPayload}
      onSettingsChange={state.setStateSettingsPayload}
      onSync={state.syncSelectedStateBackend}
      onSaveSettings={state.saveStateBackendSettings}
      onDeleteBackend={state.removeSelectedStateBackend}
      onFixPlan={state.requestStateFixPlan}
      onFixAll={state.requestStateFixAllPlan}
    />
  );
}

function WorkspaceMainContent({ state, actions, projectId }: { state: FilesystemPanelState; actions: FilesystemPanelActions; projectId: string }) {
  if (state.workspaceTab === "code") return <CodeMainView state={state} projectId={projectId} />;
  if (state.workspaceTab === "costs") return <CostsMainView state={state} actions={actions} />;
  if (state.workspaceTab === "graph") return <GraphMainView state={state} />;
  if (state.workspaceTab === "state") return <StateBackendsMainView state={state} />;
  return <JobsMainView state={state} />;
}

function FilesystemDialogs({ state, actions }: { state: FilesystemPanelState; actions: FilesystemPanelActions }) {
  return (
    <>
      <CreateRepoDialog open={state.createRepoOpen} onOpenChange={state.setCreateRepoOpen} name={state.createRepoName} onNameChange={state.setCreateRepoName} description={state.createRepoDescription} onDescriptionChange={state.setCreateRepoDescription} isPrivate={state.createRepoPrivate} onPrivateChange={state.setCreateRepoPrivate} busy={state.createRepoBusy} error={state.createRepoError} onSubmit={actions.onCreateRepo} />
      <CreatePullRequestDialog open={state.prOpen} onOpenChange={state.setPrOpen} title={state.prTitle} onTitleChange={state.setPrTitle} baseBranch={state.prBaseBranch} onBaseBranchChange={state.setPrBaseBranch} description={state.prDescription} onDescriptionChange={state.setPrDescription} error={state.prError} busy={state.prBusy} onSubmit={actions.onCreatePullRequest} githubConnected={Boolean(state.githubStatus?.connected)} placeholderBase={state.githubStatus?.base_branch || "main"} />
      <ImportRepoDialog open={state.importRepoOpen} onOpenChange={state.setImportRepoOpen} loading={state.importRepoLoading} busy={state.importRepoBusy} error={state.importRepoError} session={state.importRepoSession} repos={state.importRepoList} repoName={state.importRepoName} onRepoNameChange={state.setImportRepoName} baseBranch={state.importBaseBranch} onBaseBranchChange={state.setImportBaseBranch} onLogin={state.handleImportRepoLogin} onSubmit={actions.onImportFromGithub} />
      <StateBackendsConnectDialog
        open={state.stateConnectOpen}
        onOpenChange={state.setStateConnectOpen}
        source={state.stateConnectSource}
        onSourceChange={state.setStateConnectSource}
        busy={state.stateConnectBusy}
        error={state.stateConnectError}
        profiles={state.stateProfiles}
        profilesLoading={state.stateProfilesLoading}
        cloudProvider={state.stateCloudProvider}
        setCloudProvider={state.setStateCloudProvider}
        cloudProfileId={state.stateCloudProfileId}
        setCloudProfileId={state.setStateCloudProfileId}
        cloudName={state.stateCloudName}
        setCloudName={state.setStateCloudName}
        cloudBucket={state.stateCloudBucket}
        setCloudBucket={state.setStateCloudBucket}
        cloudPrefix={state.stateCloudPrefix}
        setCloudPrefix={state.setStateCloudPrefix}
        cloudKey={state.stateCloudKey}
        setCloudKey={state.setStateCloudKey}
        cloudBuckets={state.stateCloudBuckets}
        cloudObjects={state.stateCloudObjects}
        githubSession={state.stateGithubSession}
        githubRepos={state.stateGithubRepos}
        githubRepo={state.stateGithubRepo}
        setGithubRepo={state.setStateGithubRepo}
        githubBranch={state.stateGithubBranch}
        setGithubBranch={state.setStateGithubBranch}
        githubProfileId={state.stateGithubProfileId}
        setGithubProfileId={state.setStateGithubProfileId}
        githubCandidates={state.stateGithubCandidates}
        githubSelectedCandidates={state.stateGithubSelectedCandidates}
        setGithubSelectedCandidates={state.setStateGithubSelectedCandidates}
        gitlabSession={state.stateGitlabSession}
        gitlabRepos={state.stateGitlabRepos}
        gitlabRepo={state.stateGitlabRepo}
        setGitlabRepo={state.setStateGitlabRepo}
        gitlabBranch={state.stateGitlabBranch}
        setGitlabBranch={state.setStateGitlabBranch}
        gitlabProfileId={state.stateGitlabProfileId}
        setGitlabProfileId={state.setStateGitlabProfileId}
        gitlabCandidates={state.stateGitlabCandidates}
        gitlabSelectedCandidates={state.stateGitlabSelectedCandidates}
        setGitlabSelectedCandidates={state.setStateGitlabSelectedCandidates}
        onRunCloudImport={state.runStateCloudImport}
        onScanGitHub={state.scanStateGithubRepo}
        onImportGitHub={state.importStateGithubRepo}
        onConnectGitlab={state.connectStateGitlabOAuth}
        onScanGitLab={state.scanStateGitlabRepo}
        onImportGitLab={state.importStateGitlabRepo}
      />
    </>
  );
}

export function FilesystemPanel({ projectId, state, actions }: FilesystemPanelProps) {
  return (
    <div className="flex h-full min-h-0 overflow-hidden border-l border-[var(--da-border)] bg-[var(--da-panel)]">
      <aside className="flex h-full w-[320px] min-w-[280px] flex-col border-r border-[var(--da-border)] bg-[#0f131b]">
        <SidebarTabSelector state={state} />
        <div className="min-h-0 flex-1 overflow-hidden">
          <WorkspaceSidebarContent state={state} actions={actions} />
        </div>
      </aside>
      <section className="min-w-0 flex-1">
        <WorkspaceMainContent state={state} actions={actions} projectId={projectId} />
      </section>
      <FilesystemDialogs state={state} actions={actions} />
    </div>
  );
}

export function FilesystemJobsPage({ state }: { state: FilesystemPanelState }) {
  return (
    <div className="flex h-full min-h-0 overflow-hidden border-l border-[var(--da-border)] bg-[var(--da-panel)]">
      <aside className="flex h-full w-[320px] min-w-[280px] flex-col border-r border-[var(--da-border)] bg-[#0f131b]">
        <div className="min-h-0 flex-1 overflow-hidden">
          <JobsSidebar state={state} />
        </div>
      </aside>
      <section className="min-w-0 flex-1">
        <JobsMainView state={state} />
      </section>
    </div>
  );
}

export function FilesystemStatePage({
  state,
  actions,
}: {
  state: FilesystemPanelState;
  actions: FilesystemPanelActions;
}) {
  return (
    <div className="flex h-full min-h-0 overflow-hidden border-l border-[var(--da-border)] bg-[var(--da-panel)]">
      <aside className="flex h-full w-[320px] min-w-[280px] flex-col border-r border-[var(--da-border)] bg-[#0f131b]">
        <div className="min-h-0 flex-1 overflow-hidden">
          <StateBackendsSidebar state={state} />
        </div>
      </aside>
      <section className="min-w-0 flex-1">
        <StateBackendsMainView state={state} />
      </section>
      <FilesystemDialogs state={state} actions={actions} />
    </div>
  );
}
