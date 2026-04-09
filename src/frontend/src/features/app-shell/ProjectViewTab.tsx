import type { Project } from "../../api/projects";
import { AssistantSidebar } from "../../components/assistant-ui/assistant-sidebar";
import type { FilesystemPanelActions, FilesystemPanelState } from "../../components/FilesystemPanel";
import { FilesystemPanel } from "../../components/FilesystemPanel";
import { WorkspaceHeader } from "./WorkspaceHeader";

export function ProjectViewTab({
  projects,
  currentProject,
  currentProjectId,
  onProjectChange,
  onCreateProject,
  onRenameProject,
  projectId,
  panelState,
  panelActions,
}: {
  projects: Project[];
  currentProject: Project | undefined;
  currentProjectId: string;
  onProjectChange: (id: string) => void;
  onCreateProject: () => void;
  onRenameProject: () => void;
  projectId: string;
  panelState: FilesystemPanelState;
  panelActions: FilesystemPanelActions;
}) {
  return (
    <div className="flex h-full max-h-full min-h-0 flex-col overflow-hidden bg-[var(--da-panel)]">
      <WorkspaceHeader
        projects={projects}
        currentProject={currentProject}
        currentProjectId={currentProjectId}
        onProjectChange={onProjectChange}
        onCreateProject={onCreateProject}
        onRenameProject={onRenameProject}
        readOnly={false}
        githubStatus={panelState.githubStatus}
        workflowBusy={panelState.workflowBusy}
        onDownloadZip={panelActions.onDownloadZip}
        onOpenCreateRepo={panelState.openCreateRepoDialog}
        onOpenPullRequest={panelState.openPullRequestDialog}
        onRunWorkflow={panelActions.onRunWorkflow}
      />
      <div className="min-h-0 flex-1">
        <AssistantSidebar>
          <FilesystemPanel projectId={projectId} state={panelState} actions={panelActions} />
        </AssistantSidebar>
      </div>
    </div>
  );
}
