import { Code2, DollarSign, GitBranch } from "lucide-react";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./ui/resizable";
import {
  CostsWorkspace,
  CreatePullRequestDialog,
  CreateRepoDialog,
  EditorPane,
  ExplorerPanel,
  GraphWorkspace,
  ImportRepoDialog,
  WorkflowTabsPanel,
  useFilesystemPanelState,
} from "../features/filesystem";
import { cn } from "../lib/utils";

interface Props {
  projectId: string;
  authenticated: boolean;
}

export function FilesystemPanel({ projectId, authenticated }: Props) {
  const state = useFilesystemPanelState({ projectId, authenticated });

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden border-l border-[var(--da-border)] bg-[var(--da-panel)]">
      <div className="border-b border-[var(--da-border)] px-3 py-2">
        <div className="inline-flex rounded-lg border border-[var(--da-border)] bg-[var(--da-elevated)] p-1">
          {([
            ["code", "Code", Code2],
            ["costs", "Costs", DollarSign],
            ["graph", "Graph", GitBranch],
          ] as const).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              disabled={state.isGuest && value !== "code"}
              onClick={() => state.setWorkspaceTab(value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium",
                state.workspaceTab === value
                  ? "bg-[var(--da-panel)] text-[var(--da-text)]"
                  : "text-[var(--da-muted)] hover:text-[var(--da-text)]",
                state.isGuest && value !== "code" && "cursor-not-allowed opacity-40",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {state.workspaceTab === "code" && (
          <ResizablePanelGroup direction="horizontal" className="h-full w-full">
            <ResizablePanel defaultSize={22} minSize={14} maxSize={40}>
              <ExplorerPanel
                tree={state.tree}
                selectedPath={state.selectedPath}
                readOnly={state.isGuest}
                expandedFolders={state.expandedFolders}
                toggleFolder={state.toggleFolder}
                onOpenFile={(path) => {
                  void state.handleOpenFile(path);
                }}
                onDelete={(path, isFolder) => {
                  void state.handleDelete(path, isFolder);
                }}
                onRefresh={() => {
                  void state.handleRefresh();
                }}
                newItemMode={state.newItemMode}
                setNewItemMode={state.setNewItemMode}
                onNewFile={(name) => {
                  void state.handleNewFile(name);
                }}
                onNewFolder={(name) => {
                  void state.handleNewFolder(name);
                }}
                onOpenImportGitHub={state.openImportRepoDialog}
                onUploadZip={(file) => {
                  void state.handleUploadZip(file);
                }}
                importBusy={state.importRepoBusy || state.zipImportBusy}
                importError={state.importRepoError || state.zipImportError}
              />
            </ResizablePanel>

            <ResizableHandle withHandle />

            <ResizablePanel minSize={45} className="min-w-0">
              <ResizablePanelGroup direction="vertical" className="h-full">
                <ResizablePanel defaultSize={78} minSize={40}>
                  <EditorPane
                    selectedPath={state.selectedPath}
                    readOnly={state.isGuest}
                    isDirty={state.isDirty}
                    isLoading={state.isLoading}
                    language={state.language}
                    content={state.content}
                    setContent={state.setContent}
                    exportError={state.exportError}
                    workflowError={state.workflowError}
                    githubStatus={state.githubStatus}
                    workflowBusy={state.workflowBusy}
                    onDownloadZip={() => {
                      void state.handleDownloadZip();
                    }}
                    onOpenCreateRepo={state.openCreateRepoDialog}
                    onOpenPullRequest={state.openPullRequestDialog}
                    onRunWorkflow={(mode) => {
                      void state.handleRunWorkflow(mode);
                    }}
                    onSave={() => {
                      void state.handleSave();
                    }}
                  />
                </ResizablePanel>

                <ResizableHandle withHandle />

                <ResizablePanel defaultSize={22} minSize={12} maxSize={45}>
                  <WorkflowTabsPanel
                    workflowTab={state.workflowTab}
                    setWorkflowTab={state.setWorkflowTab}
                    activityLogs={state.activityLogs}
                    workflowProblems={state.workflowProblems}
                  />
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}

        {state.workspaceTab === "costs" && (
          <CostsWorkspace
            data={state.costData}
            loading={state.costLoading}
            error={state.costError}
            scope={state.costScope}
            onScopeChange={state.setCostScope}
            onRefresh={() => {
              void state.refreshCosts();
            }}
            expandedResourceIds={state.expandedCostResources}
            onToggleResource={state.toggleCostResource}
          />
        )}

        {state.workspaceTab === "graph" && (
          <GraphWorkspace
            data={state.graphData}
            loading={state.graphLoading}
            error={state.graphError}
            scope={state.graphScope}
            onScopeChange={state.setGraphScope}
            mode={state.graphViewMode}
            onModeChange={state.setGraphViewMode}
            modules={state.graphModules}
            stale={state.graphStale}
            selectedNodeId={state.selectedGraphNodeId}
            onSelectedNodeIdChange={state.setSelectedGraphNodeId}
            selectedNode={state.selectedGraphNode}
            onRefresh={() => {
              void state.refreshGraph();
            }}
          />
        )}
      </div>

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
        onSubmit={() => {
          void state.handleCreateGitHubRepository();
        }}
      />

      <CreatePullRequestDialog
        open={state.prOpen}
        onOpenChange={state.setPrOpen}
        title={state.prTitle}
        onTitleChange={state.setPrTitle}
        baseBranch={state.prBaseBranch}
        onBaseBranchChange={state.setPrBaseBranch}
        description={state.prDescription}
        onDescriptionChange={state.setPrDescription}
        error={state.prError}
        busy={state.prBusy}
        onSubmit={() => {
          void state.handleCreatePullRequest();
        }}
        githubConnected={Boolean(state.githubStatus?.connected)}
        placeholderBase={state.githubStatus?.base_branch || "main"}
      />

      <ImportRepoDialog
        open={state.importRepoOpen}
        onOpenChange={state.setImportRepoOpen}
        loading={state.importRepoLoading}
        busy={state.importRepoBusy}
        error={state.importRepoError}
        session={state.importRepoSession}
        repos={state.importRepoList}
        repoName={state.importRepoName}
        onRepoNameChange={state.setImportRepoName}
        baseBranch={state.importBaseBranch}
        onBaseBranchChange={state.setImportBaseBranch}
        onLogin={state.handleImportRepoLogin}
        onSubmit={() => {
          void state.handleImportFromGitHub();
        }}
      />
    </div>
  );
}
