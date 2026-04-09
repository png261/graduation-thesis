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
            disabled={false}
            onClick={() => state.setWorkspaceTab(value)}
            className={cn(
              "inline-flex h-12 items-center justify-center gap-2 rounded-lg border text-sm font-semibold",
              state.workspaceTab === value
                ? "border-[var(--da-accent)] bg-[color-mix(in_srgb,var(--da-accent)_10%,var(--da-elevated))] text-[var(--da-text)]"
                : "border-transparent bg-transparent text-[var(--da-muted)] hover:bg-[var(--da-panel)] hover:text-[var(--da-text)]",
              "cursor-not-allowed opacity-40",
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
    <ExplorerPanel
      tree={state.tree}
      selectedPath={state.selectedPath}
      selectedPaths={state.selectedPaths}
      expandedFolders={state.expandedFolders}
      toggleFolder={state.toggleFolder}
      onOpenFile={actions.onOpenFile}
      onSelectionChange={actions.onSelectionChange}
      onMovePaths={actions.onMove}
      onRenamePath={actions.onRename}
      onDelete={actions.onDelete}
      onRefresh={actions.onRefresh}
      newItemMode={state.newItemMode}
      setNewItemMode={state.setNewItemMode}
      onNewFile={actions.onNewFile}
      onNewFolder={actions.onNewFolder}
      onOpenImportGitHub={state.openImportRepoDialog}
      onUploadZip={actions.onUploadZip}
      importBusy={state.importRepoBusy || state.zipImportBusy}
      importError={state.importRepoError || state.zipImportError}
    />
  );
}

function CostsSidebar({ state }: { state: FilesystemPanelState }) {
  return (
    <CostsWorkspaceSidebarPanel
      data={state.costData}
      scope={state.costScope}
      onScopeChange={state.setCostScope}
      className="h-full overflow-y-auto"
    />
  );
}

function GraphSidebarView({ state, actions }: { state: FilesystemPanelState; actions: FilesystemPanelActions }) {
  return (
    <GraphSidebar
      modules={state.graphModules}
      scope={state.graphScope}
      loading={state.graphLoading}
      onScopeChange={state.setGraphScope}
      onRefresh={actions.onRefreshGraph}
      className="h-full w-full border-r-0"
    />
  );
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

function CodeMainToolbar({
  selectedPath,
  content,
  isLoading,
}: {
  selectedPath: string | null;
  content: string;
  isLoading: boolean;
}) {
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
    <div className="flex h-14 items-center justify-between gap-3 border-b border-[var(--da-border)] bg-[var(--da-panel)] px-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="truncate font-mono text-sm font-medium text-[var(--da-text)]">
          {selectedPath || "No file selected"}
        </span>
        <span className="rounded-full border border-[var(--da-border)] bg-[var(--da-elevated)] px-2.5 py-1 text-xs font-medium text-[var(--da-muted)]">
          v0.0.1
        </span>
      </div>
      <button
        type="button"
        onClick={() => void handleCopy()}
        disabled={!canCopy}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold",
          canCopy
            ? "text-[var(--da-text)] hover:bg-[var(--da-elevated)]"
            : "cursor-not-allowed text-[var(--da-muted)]/65",
        )}
      >
        {copied ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
        {copied ? "Copied" : "Copy code"}
      </button>
    </div>
  );
}

function CodeMainView({ state, projectId }: { state: FilesystemPanelState; projectId: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--da-bg)]">
      <CodeMainToolbar selectedPath={state.selectedPath} content={state.content} isLoading={state.isLoading} />
      <div className="min-h-0 flex-1">
        <EditorPane
          projectId={projectId}
          selectedPath={state.selectedPath}
          isLoading={state.isLoading}
          language={state.language}
          content={state.content}
          setContent={state.setContent}
          exportError={state.exportError}
          workflowError={state.workflowError}
        />
      </div>
    </div>
  );
}

function CostsMainView({ state, actions }: { state: FilesystemPanelState; actions: FilesystemPanelActions }) {
  return (
    <CostsWorkspaceMainPanel
      data={state.costData}
      loading={state.costLoading}
      error={state.costError}
      onRefresh={actions.onRefreshCosts}
      expandedResourceIds={state.expandedCostResources}
      onToggleResource={state.toggleCostResource}
    />
  );
}

function GraphMainView({ state }: { state: FilesystemPanelState }) {
  return (
    <GraphWorkspaceMainPanel
      data={state.graphData}
      loading={state.graphLoading}
      error={state.graphError}
      scope={state.graphScope}
      mode={state.graphViewMode}
      onModeChange={state.setGraphViewMode}
      modules={state.graphModules}
      stale={state.graphStale}
      selectedNodeId={state.selectedGraphNodeId}
      onSelectedNodeIdChange={state.setSelectedGraphNodeId}
      selectedNode={state.selectedGraphNode}
    />
  );
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
      deployDriftSummary={state.stateDeployDriftSummary}
      deployDriftLoading={state.stateDeployDriftLoading}
      deployDriftError={state.stateDeployDriftError}
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
      onSetPrimary={state.markStateBackendPrimaryForDeploy}
      onSaveSettings={state.saveStateBackendSettings}
      onDeleteBackend={state.removeSelectedStateBackend}
      onFixPlan={state.requestStateFixPlan}
      onFixAll={state.requestStateFixAllPlan}
    />
  );
}

function WorkspaceMainContent({
  state,
  actions,
  projectId,
}: {
  state: FilesystemPanelState;
  actions: FilesystemPanelActions;
  projectId: string;
}) {
  if (state.workspaceTab === "code") return <CodeMainView state={state} projectId={projectId} />;
  if (state.workspaceTab === "costs") return <CostsMainView state={state} actions={actions} />;
  if (state.workspaceTab === "graph") return <GraphMainView state={state} />;
  if (state.workspaceTab === "state") return <StateBackendsMainView state={state} />;
  return <JobsMainView state={state} />;
}

function FilesystemDialogs({ state, actions }: { state: FilesystemPanelState; actions: FilesystemPanelActions }) {
  return (
    <>
      <CreateRepoDialog
        open={state.createRepoOpen}
        onOpenChange={state.setCreateRepoOpen}
        name={state.createRepoName}
        onNameChange={state.setCreateRepoName}
        description={state.createRepoDescription}
        onDescriptionChange={state.setCreateRepoDescription}
        isPrivate={state.createRepoPrivate}
        onPrivateChange={state.setCreateRepoPrivate}
        busy={state.createRepoBusy}
        error={state.createRepoError}
        onSubmit={actions.onCreateRepo}
      />
      <CreatePullRequestDialog
        open={state.prOpen}
        onOpenChange={state.setPrOpen}
        loading={state.prLoading}
        title={state.prTitle}
        onTitleChange={state.setPrTitle}
        baseBranch={state.prBaseBranch}
        onBaseBranchChange={state.setPrBaseBranch}
        description={state.prDescription}
        onDescriptionChange={state.setPrDescription}
        error={state.prError}
        busy={state.prBusy}
        onSubmit={actions.onCreatePullRequest}
        githubConnected={Boolean(state.githubStatus?.connected)}
        placeholderBase={state.githubStatus?.base_branch || "main"}
        workingBranch={state.prWorkingBranch || state.githubStatus?.working_branch || ""}
        suggestionCopy={state.prSuggestionCopy}
      />
      <ImportRepoDialog
        open={state.importRepoOpen}
        onOpenChange={state.setImportRepoOpen}
        loading={state.importRepoLoading}
        busy={state.importRepoBusy}
        error={state.importRepoError}
        connected={Boolean(state.githubStatus?.connected)}
        actionLabel={state.githubStatus?.connected ? "Sync Repository Baseline" : "Import Repository"}
        pendingConfirmationMessage={state.pendingRepositoryConfirmation?.confirmationMessage || ""}
        session={state.importRepoSession}
        repos={state.importRepoList}
        repoName={state.importRepoName}
        onRepoNameChange={(value) => {
          state.clearPendingRepositoryConfirmation();
          state.setImportRepoName(value);
        }}
        baseBranch={state.importBaseBranch}
        onBaseBranchChange={(value) => {
          state.clearPendingRepositoryConfirmation();
          state.setImportBaseBranch(value);
        }}
        onLogin={state.handleImportRepoLogin}
        onSubmit={actions.onImportFromGithub}
      />
      <StateBackendsConnectDialog
        open={state.stateConnectOpen}
        onOpenChange={state.setStateConnectOpen}
        busy={state.stateConnectBusy}
        error={state.stateConnectError}
        cloudProvider={state.stateCloudProvider}
        setCloudProvider={state.setStateCloudProvider}
        cloudAccessKeyId={state.stateCloudAccessKeyId}
        setCloudAccessKeyId={state.setStateCloudAccessKeyId}
        cloudSecretAccessKey={state.stateCloudSecretAccessKey}
        setCloudSecretAccessKey={state.setStateCloudSecretAccessKey}
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
        onRunCloudImport={state.runStateCloudImport}
      />
    </>
  );
}

export function FilesystemPanel({ projectId, state, actions }: FilesystemPanelProps) {
  return (
    <div className="flex h-full min-h-0 overflow-hidden border-l border-[var(--da-border)] bg-[var(--da-panel)]">
      <aside className="flex h-full w-[352px] min-w-[304px] flex-col border-r border-[var(--da-border)] bg-[var(--da-elevated)]">
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
      <aside className="flex h-full w-[352px] min-w-[304px] flex-col border-r border-[var(--da-border)] bg-[var(--da-elevated)]">
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
      <aside className="flex h-full w-[352px] min-w-[304px] flex-col border-r border-[var(--da-border)] bg-[var(--da-elevated)]">
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
