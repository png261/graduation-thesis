import { useMemo, useState } from "react";

import { useAuth } from "./contexts/AuthContext";
import { FilesystemContextProvider } from "./contexts/FilesystemContext";
import { useProjects } from "./hooks/useProjects";
import { getSuggestions } from "./lib/suggestions";
import { LocalRuntimeProvider } from "./runtime/LocalRuntimeProvider";
import { ProjectViewTab, WorkspaceSidebar } from "./features/app-shell";
import { ProjectConfigTab } from "./features/project-config";
import {
  CreateProjectDialog,
  RenameProjectDialog,
  useProjectCreateDialog,
  useRenameProjectDialog,
} from "./features/project-create";

export default function App() {
  const { session, loading: authLoading, error: authError, login, logout } = useAuth();
  const authenticated = session.authenticated;
  const userId = session.user?.id;
  const userScope = `user:${userId ?? "unknown"}`;

  const {
    projects,
    currentProject,
    currentProjectId,
    setCurrentProjectId,
    createProject,
    renameProject,
    deleteProject,
    loading,
  } = useProjects({ authenticated, userId });

  const [workspaceTab, setWorkspaceTab] = useState<"view" | "config">("view");

  const createDialog = useProjectCreateDialog({
    createProject,
  });

  const renameDialog = useRenameProjectDialog({
    currentProjectName: currentProject?.name ?? "",
    currentProjectId: currentProject?.id ?? "",
    onRename: renameProject,
  });

  const suggestions = useMemo(() => getSuggestions(currentProject?.name ?? ""), [currentProject?.name]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--da-bg)] text-[var(--da-text)]">
        <p className="text-sm text-[var(--da-muted)]">Loading session...</p>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--da-bg)] text-[var(--da-text)]">
        <div className="w-full max-w-md rounded-lg border border-[var(--da-border)] bg-[var(--da-panel)] p-6">
          <h1 className="text-lg font-semibold">Sign in required</h1>
          <p className="mt-2 text-sm text-[var(--da-muted)]">
            Sign in with GitHub to access projects, chat, deploy workflows, and code sync.
          </p>
          <div className="mt-4 space-y-2">
            <button
              type="button"
              className="h-9 w-full rounded-md bg-[var(--da-primary)] px-3 text-sm font-medium text-[var(--da-primary-foreground)]"
              onClick={login}
            >
              Sign in with GitHub
            </button>
            {authError ? (
              <p className="pt-1 text-xs text-red-400">{authError}</p>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  if (loading || !currentProjectId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--da-bg)] text-[var(--da-text)]">
        <p className="text-sm text-[var(--da-muted)]">Loading projects...</p>
      </div>
    );
  }

  return (
    <div className="h-screen max-h-screen overflow-hidden bg-[var(--da-bg)] text-[var(--da-text)]">
      <FilesystemContextProvider>
        <LocalRuntimeProvider
          key={`${userScope}:${currentProjectId}`}
          projectId={currentProjectId}
          authenticated
          userScope={userScope}
        >
          <main className="h-full max-h-full">
            <div className="grid h-full max-h-full w-full grid-cols-[220px_minmax(0,1fr)]">
              <WorkspaceSidebar
                projects={projects}
                currentProject={currentProject}
                currentProjectId={currentProjectId}
                authenticated
                canOpenConfig
                accountName={session.user?.name}
                accountEmail={session.user?.email}
                accountAvatarUrl={session.user?.avatarUrl}
                onProjectChange={setCurrentProjectId}
                onCreateProject={() => createDialog.handleCreateDialogOpenChange(true)}
                onRenameProject={() => renameDialog.setRenameOpen(true)}
                onLogin={login}
                onLogout={() => {
                  void logout();
                }}
                workspaceTab={workspaceTab}
                onChange={setWorkspaceTab}
              />

              {workspaceTab === "view" ? (
                <ProjectViewTab
                  projectId={currentProjectId}
                  authenticated
                  suggestions={suggestions}
                />
              ) : (
                <div className="min-h-0 overflow-y-auto px-3 py-3">
                  <ProjectConfigTab
                    projectId={currentProjectId}
                    projectName={currentProject?.name ?? ""}
                    provider={currentProject?.provider}
                    projectCount={projects.length}
                    onDeleteProject={async () => {
                      await deleteProject(currentProjectId);
                    }}
                  />
                </div>
              )}
            </div>
          </main>
        </LocalRuntimeProvider>
      </FilesystemContextProvider>

      <CreateProjectDialog model={createDialog} />

      <RenameProjectDialog
        open={renameDialog.renameOpen}
        onOpenChange={renameDialog.setRenameOpen}
        draft={renameDialog.renameDraft}
        onDraftChange={renameDialog.setRenameDraft}
        onSave={renameDialog.handleRenameProject}
      />
    </div>
  );
}
