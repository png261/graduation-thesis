import { useMemo, useState } from "react";

import { useAuth } from "./contexts/AuthContext";
import { FilesystemContextProvider } from "./contexts/FilesystemContext";
import { createFilesystemPanelActions, FilesystemJobsPage, FilesystemStatePage } from "./components/FilesystemPanel";
import { ProjectViewTab, WorkspaceHeader, WorkspaceSidebar } from "./features/app-shell";
import { useFilesystemPanelState } from "./features/filesystem";
import {
  CreateProjectDialog,
  RenameProjectDialog,
  useProjectCreateDialog,
  useRenameProjectDialog,
} from "./features/project-create";
import { ProjectConfigTab } from "./features/project-config";
import { useProjects } from "./hooks/useProjects";
import { getSuggestions } from "./lib/suggestions";
import { LocalRuntimeProvider } from "./runtime/LocalRuntimeProvider";

function LoadingState({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--da-bg)] text-[var(--da-text)]">
      <p className="text-sm text-[var(--da-muted)]">{message}</p>
    </div>
  );
}

function SignInState({
  authError,
  login,
}: {
  authError: string;
  login: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--da-bg)] text-[var(--da-text)]">
      <div className="w-full max-w-md rounded-lg border border-[var(--da-border)] bg-[var(--da-panel)] p-6">
        <h1 className="text-lg font-semibold">Sign in required</h1>
        <p className="mt-2 text-sm text-[var(--da-muted)]">
          Sign in with Cognito to access projects, chat, deploy workflows, and code sync.
        </p>
        <div className="mt-4 space-y-2">
          <button
            type="button"
            className="h-9 w-full rounded-md bg-[var(--da-primary)] px-3 text-sm font-medium text-[var(--da-primary-foreground)]"
            onClick={login}
          >
            Sign in with Cognito
          </button>
          {authError ? <p className="pt-1 text-xs text-red-400">{authError}</p> : null}
        </div>
      </div>
    </div>
  );
}

function ProjectLoadErrorState({
  loadError,
  reloadProjects,
  logout,
}: {
  loadError: string | null;
  reloadProjects: () => void;
  logout: () => Promise<void>;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--da-bg)] text-[var(--da-text)]">
      <div className="w-full max-w-md rounded-lg border border-[var(--da-border)] bg-[var(--da-panel)] p-6">
        <h1 className="text-lg font-semibold">Unable to load projects</h1>
        <p className="mt-2 text-sm text-[var(--da-muted)]">{loadError || "No project is currently available."}</p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            className="h-9 rounded-md bg-[var(--da-primary)] px-3 text-sm font-medium text-[var(--da-primary-foreground)]"
            onClick={reloadProjects}
          >
            Retry
          </button>
          <button
            type="button"
            className="h-9 rounded-md border border-[var(--da-border)] px-3 text-sm"
            onClick={() => {
              void logout();
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

type WorkspaceShellArgs = {
  userScope: string;
  currentProjectId: string;
  workspaceTab: "view" | "jobs" | "state" | "config";
  setWorkspaceTab: (tab: "view" | "jobs" | "state" | "config") => void;
  session: ReturnType<typeof useAuth>["session"];
  login: () => void;
  logout: () => Promise<void>;
  openUserSettings: () => void;
  projects: ReturnType<typeof useProjects>["projects"];
  currentProject: ReturnType<typeof useProjects>["currentProject"];
  setCurrentProjectId: ReturnType<typeof useProjects>["setCurrentProjectId"];
  createDialog: ReturnType<typeof useProjectCreateDialog>;
  renameDialog: ReturnType<typeof useRenameProjectDialog>;
  suggestions: ReturnType<typeof getSuggestions>;
  deleteProject: ReturnType<typeof useProjects>["deleteProject"];
};

function WorkspaceProjectHeader({
  args,
  panelState,
  panelActions,
}: {
  args: WorkspaceShellArgs;
  panelState: ReturnType<typeof useFilesystemPanelState>;
  panelActions: ReturnType<typeof createFilesystemPanelActions>;
}) {
  return (
    <WorkspaceHeader
      projects={args.projects}
      currentProject={args.currentProject}
      currentProjectId={args.currentProjectId}
      onProjectChange={args.setCurrentProjectId}
      onCreateProject={() => args.createDialog.handleCreateDialogOpenChange(true)}
      onRenameProject={() => args.renameDialog.setRenameOpen(true)}
      readOnly={panelState.isGuest}
      githubStatus={panelState.githubStatus}
      workflowBusy={panelState.workflowBusy}
      onDownloadZip={panelActions.onDownloadZip}
      onOpenCreateRepo={panelState.openCreateRepoDialog}
      onOpenPullRequest={panelState.openPullRequestDialog}
      onRunWorkflow={panelActions.onRunWorkflow}
    />
  );
}

function JobsPage({
  args,
  panelState,
  panelActions,
}: {
  args: WorkspaceShellArgs;
  panelState: ReturnType<typeof useFilesystemPanelState>;
  panelActions: ReturnType<typeof createFilesystemPanelActions>;
}) {
  return (
    <div className="flex h-full max-h-full min-h-0 flex-col overflow-hidden bg-[var(--da-panel)]">
      <WorkspaceProjectHeader args={args} panelState={panelState} panelActions={panelActions} />
      <div className="min-h-0 flex-1">
        <FilesystemJobsPage state={panelState} />
      </div>
    </div>
  );
}

function StatePage({
  args,
  panelState,
  panelActions,
}: {
  args: WorkspaceShellArgs;
  panelState: ReturnType<typeof useFilesystemPanelState>;
  panelActions: ReturnType<typeof createFilesystemPanelActions>;
}) {
  return (
    <div className="flex h-full max-h-full min-h-0 flex-col overflow-hidden bg-[var(--da-panel)]">
      <WorkspaceProjectHeader args={args} panelState={panelState} panelActions={panelActions} />
      <div className="min-h-0 flex-1">
        <FilesystemStatePage state={panelState} actions={panelActions} />
      </div>
    </div>
  );
}

function WorkspaceBody({ args }: { args: WorkspaceShellArgs }) {
  const panelState = useFilesystemPanelState({ projectId: args.currentProjectId, authenticated: true });
  const panelActions = createFilesystemPanelActions(panelState);

  return (
    <div className="grid h-full max-h-full w-full grid-cols-[72px_minmax(0,1fr)]">
      <WorkspaceSidebar
        authenticated
        canOpenConfig
        accountName={args.session.user?.name}
        accountEmail={args.session.user?.email}
        accountAvatarUrl={args.session.user?.avatarUrl}
        onLogin={args.login}
        onLogout={() => {
          void args.logout();
        }}
        onOpenUserSettings={args.openUserSettings}
        workspaceTab={args.workspaceTab}
        onChange={args.setWorkspaceTab}
      />
      {args.workspaceTab === "view" ? (
        <ProjectViewTab
          projects={args.projects}
          currentProject={args.currentProject}
          currentProjectId={args.currentProjectId}
          onProjectChange={args.setCurrentProjectId}
          onCreateProject={() => args.createDialog.handleCreateDialogOpenChange(true)}
          onRenameProject={() => args.renameDialog.setRenameOpen(true)}
          projectId={args.currentProjectId}
          panelState={panelState}
          panelActions={panelActions}
          suggestions={args.suggestions}
        />
      ) : args.workspaceTab === "jobs" ? (
        <JobsPage args={args} panelState={panelState} panelActions={panelActions} />
      ) : args.workspaceTab === "state" ? (
        <StatePage args={args} panelState={panelState} panelActions={panelActions} />
      ) : (
        <div className="min-h-0 overflow-y-auto px-3 py-3">
          <ProjectConfigTab
            projectId={args.currentProjectId}
            projectName={args.currentProject?.name ?? ""}
            provider={args.currentProject?.provider}
            projectCount={args.projects.length}
            onDeleteProject={async () => {
              await args.deleteProject(args.currentProjectId);
            }}
            onOpenRunDetails={(runId) => {
              panelState.setSelectedJobId(runId);
              args.setWorkspaceTab("jobs");
            }}
          />
        </div>
      )}
    </div>
  );
}

function WorkspaceDialogs({ args }: { args: WorkspaceShellArgs }) {
  return (
    <>
      <CreateProjectDialog model={args.createDialog} />
      <RenameProjectDialog
        open={args.renameDialog.renameOpen}
        onOpenChange={args.renameDialog.setRenameOpen}
        draft={args.renameDialog.renameDraft}
        onDraftChange={args.renameDialog.setRenameDraft}
        onSave={args.renameDialog.handleRenameProject}
      />
    </>
  );
}

function WorkspaceShell(args: WorkspaceShellArgs) {
  return (
    <div className="h-screen max-h-screen overflow-hidden bg-[var(--da-bg)] text-[var(--da-text)]">
      <FilesystemContextProvider>
        <LocalRuntimeProvider
          key={`${args.userScope}:${args.currentProjectId}`}
          projectId={args.currentProjectId}
          authenticated
          userScope={args.userScope}
        >
          <main className="h-full max-h-full">
            <WorkspaceBody args={args} />
          </main>
        </LocalRuntimeProvider>
      </FilesystemContextProvider>

      <WorkspaceDialogs args={args} />
    </div>
  );
}

export default function App() {
  const { session, loading: authLoading, error: authError, login, logout, openUserSettings } = useAuth();
  const authenticated = session.authenticated;
  const userId = session.user?.id;
  const userScope = `user:${userId ?? "unknown"}`;
  const projectsState = useProjects({ authenticated, userId });
  const [workspaceTab, setWorkspaceTab] = useState<"view" | "jobs" | "state" | "config">("view");
  const createDialog = useProjectCreateDialog({ createProject: projectsState.createProject });
  const renameDialog = useRenameProjectDialog({
    currentProjectName: projectsState.currentProject?.name ?? "",
    currentProjectId: projectsState.currentProject?.id ?? "",
    onRename: projectsState.renameProject,
  });
  const suggestions = useMemo(() => getSuggestions(projectsState.currentProject?.name ?? ""), [projectsState.currentProject?.name]);

  if (authLoading) return <LoadingState message="Loading session..." />;
  if (!authenticated) return <SignInState authError={authError} login={login} />;
  if (projectsState.loading) return <LoadingState message="Loading projects..." />;
  const currentProjectId = projectsState.currentProjectId;
  if (!currentProjectId) {
    return <ProjectLoadErrorState loadError={projectsState.loadError} reloadProjects={projectsState.reloadProjects} logout={logout} />;
  }

  return (
    <WorkspaceShell
      userScope={userScope}
      currentProjectId={currentProjectId}
      workspaceTab={workspaceTab}
      setWorkspaceTab={setWorkspaceTab}
      session={session}
      login={login}
      logout={logout}
      openUserSettings={openUserSettings}
      projects={projectsState.projects}
      currentProject={projectsState.currentProject}
      setCurrentProjectId={projectsState.setCurrentProjectId}
      createDialog={createDialog}
      renameDialog={renameDialog}
      suggestions={suggestions}
      deleteProject={projectsState.deleteProject}
    />
  );
}
