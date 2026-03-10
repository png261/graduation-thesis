import { useEffect, useMemo, useState } from "react";

import { useAuth } from "./contexts/AuthContext";
import { FilesystemContextProvider } from "./contexts/FilesystemContext";
import { importGuestProject } from "./api/projects/index";
import { getGuestFilesSnapshot } from "./hooks/useFilesystem";
import { useProjects } from "./hooks/useProjects";
import { isGuestProjectId } from "./lib/project-id";
import { getSuggestions } from "./lib/suggestions";
import { LocalRuntimeProvider } from "./runtime/LocalRuntimeProvider";
import { getGuestThreadsSnapshot } from "./runtime/local-runtime/useProjectThreadListAdapter";
import { ProjectViewTab, WorkspaceSidebar } from "./features/app-shell";
import { ProjectConfigTab } from "./features/project-config";
import {
  CreateProjectDialog,
  RenameProjectDialog,
  useProjectCreateDialog,
  useRenameProjectDialog,
} from "./features/project-create";

export default function App() {
  const { session, loading: authLoading, login, logout } = useAuth();
  const authenticated = session.authenticated;
  const userId = session.user?.id;
  const userScope = authenticated && userId ? `user:${userId}` : "guest";

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
  const projectAccessEnabled = authenticated && !isGuestProjectId(currentProjectId);

  const [workspaceTab, setWorkspaceTab] = useState<"view" | "config">("view");
  const guestImportStorageKey = "da_guest_import_snapshot";

  type GuestImportDraft = {
    name: string;
    provider: "aws" | "gcloud" | null;
    files: Array<{ path: string; content: string }>;
    threads: Array<{ id: string; title: string }>;
  };

  const persistGuestImportDraft = () => {
    if (authenticated || !currentProject) {
      sessionStorage.removeItem(guestImportStorageKey);
      return;
    }

    const files = getGuestFilesSnapshot(currentProject.id);
    const threads = getGuestThreadsSnapshot(currentProject.id);
    const hasGuestWork = threads.length > 0 || files.length > 0;

    if (!hasGuestWork) {
      sessionStorage.removeItem(guestImportStorageKey);
      return;
    }

    const payload: GuestImportDraft = {
      name: currentProject.name,
      provider: currentProject.provider,
      files,
      threads,
    };
    sessionStorage.setItem(guestImportStorageKey, JSON.stringify(payload));
  };

  useEffect(() => {
    if (!projectAccessEnabled && workspaceTab === "config") {
      setWorkspaceTab("view");
    }
  }, [projectAccessEnabled, workspaceTab]);

  const createDialog = useProjectCreateDialog({
    createProject,
  });

  useEffect(() => {
    if (authLoading || !authenticated) return;

    const raw = sessionStorage.getItem(guestImportStorageKey);
    if (!raw) return;

    let snapshot: GuestImportDraft | null = null;
    try {
      snapshot = JSON.parse(raw) as GuestImportDraft;
    } catch {
      sessionStorage.removeItem(guestImportStorageKey);
      return;
    }
    sessionStorage.removeItem(guestImportStorageKey);

    const shouldImport = window.confirm(
      "Save your current guest session into your account now?",
    );
    if (!shouldImport) return;

    void (async () => {
      try {
        await importGuestProject({
          name: snapshot.name || "Imported Guest Session",
          provider: snapshot.provider === "gcloud" ? "gcloud" : "aws",
          files: snapshot.files,
          threads: snapshot.threads,
        });
        window.location.reload();
      } catch (error) {
        console.error("Failed to import guest session", error);
      }
    })();
  }, [authLoading, authenticated]);

  const renameDialog = useRenameProjectDialog({
    currentProjectName: currentProject?.name ?? "",
    currentProjectId: currentProject?.id ?? "",
    onRename: renameProject,
  });

  const suggestions = useMemo(() => getSuggestions(currentProject?.name ?? ""), [currentProject?.name]);

  if (authLoading || loading || !currentProjectId) {
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
          authenticated={projectAccessEnabled}
          userScope={userScope}
        >
          <main className="h-full max-h-full">
            <div className="grid h-full max-h-full w-full grid-cols-[220px_minmax(0,1fr)]">
              <WorkspaceSidebar
                projects={projects}
                currentProject={currentProject}
                currentProjectId={currentProjectId}
                authenticated={authenticated}
                canOpenConfig={projectAccessEnabled}
                accountName={session.user?.name}
                accountEmail={session.user?.email}
                accountAvatarUrl={session.user?.avatarUrl}
                onProjectChange={setCurrentProjectId}
                onCreateProject={() => createDialog.handleCreateDialogOpenChange(true)}
                onRenameProject={() => renameDialog.setRenameOpen(true)}
                onLogin={(provider) => {
                  persistGuestImportDraft();
                  login(provider);
                }}
                onLogout={() => {
                  void logout();
                }}
                workspaceTab={workspaceTab}
                onChange={setWorkspaceTab}
              />

              {workspaceTab === "view" ? (
                <ProjectViewTab
                  projectId={currentProjectId}
                  authenticated={projectAccessEnabled}
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
