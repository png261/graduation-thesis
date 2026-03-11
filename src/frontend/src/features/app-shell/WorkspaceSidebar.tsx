import { ChevronDown, MessageSquareText, Settings2 } from "lucide-react";

import type { Project } from "../../api/projects";
import { Button } from "../../components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { ProviderBadge } from "../project-config";

interface WorkspaceSidebarProps {
  projects: Project[];
  currentProject: Project | undefined;
  currentProjectId: string;
  authenticated: boolean;
  canOpenConfig: boolean;
  accountName?: string;
  accountEmail?: string;
  accountAvatarUrl?: string | null;
  onProjectChange: (id: string) => void;
  onCreateProject: () => void;
  onRenameProject: () => void;
  onLogin: () => void;
  onLogout: () => void;
  workspaceTab: "view" | "config";
  onChange: (tab: "view" | "config") => void;
}

function ProjectSwitcher({
  projects,
  currentProject,
  currentProjectId,
  onProjectChange,
  onCreateProject,
  onRenameProject,
}: {
  projects: Project[];
  currentProject: Project | undefined;
  currentProjectId: string;
  onProjectChange: (id: string) => void;
  onCreateProject: () => void;
  onRenameProject: () => void;
}) {
  return (
    <DropdownMenu>
      <ProjectSwitcherTrigger currentProject={currentProject} />
      <ProjectSwitcherContent projects={projects} currentProjectId={currentProjectId} onProjectChange={onProjectChange} onCreateProject={onCreateProject} onRenameProject={onRenameProject} />
    </DropdownMenu>
  );
}

function ProjectSwitcherTrigger({ currentProject }: { currentProject: Project | undefined }) {
  return (
    <DropdownMenuTrigger asChild>
      <Button variant="outline" className="h-11 w-full justify-between">
        <span className="truncate">{currentProject?.name || "Select project"}</span>
        <ChevronDown className="h-4 w-4" />
      </Button>
    </DropdownMenuTrigger>
  );
}

function ProjectSwitcherProjectOptions({
  projects,
}: {
  projects: Project[];
}) {
  return (
    <>
      {projects.map((project) => (
        <DropdownMenuRadioItem key={project.id} value={project.id}>
          <div className="flex w-full items-center justify-between gap-2">
            <span className="truncate">{project.name}</span>
            <ProviderBadge provider={project.provider} />
          </div>
        </DropdownMenuRadioItem>
      ))}
    </>
  );
}

function ProjectSwitcherContent({
  projects,
  currentProjectId,
  onProjectChange,
  onCreateProject,
  onRenameProject,
}: {
  projects: Project[];
  currentProjectId: string;
  onProjectChange: (id: string) => void;
  onCreateProject: () => void;
  onRenameProject: () => void;
}) {
  return (
    <DropdownMenuContent align="start" className="w-72">
      <DropdownMenuLabel>Projects</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuRadioGroup value={currentProjectId} onValueChange={onProjectChange}>
        <ProjectSwitcherProjectOptions projects={projects} />
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onCreateProject}>Create Project</DropdownMenuItem>
      <DropdownMenuItem onSelect={onRenameProject}>Rename Current Project</DropdownMenuItem>
    </DropdownMenuContent>
  );
}

function WorkspaceTabActions({
  workspaceTab,
  canOpenConfig,
  onChange,
}: {
  workspaceTab: "view" | "config";
  canOpenConfig: boolean;
  onChange: (tab: "view" | "config") => void;
}) {
  return (
    <>
      <Button variant={workspaceTab === "view" ? "default" : "ghost"} className="justify-start gap-2" onClick={() => onChange("view")}>
        <MessageSquareText className="h-4 w-4" />
        Chat
      </Button>
      <Button variant={workspaceTab === "config" ? "default" : "ghost"} className="justify-start gap-2" disabled={!canOpenConfig} onClick={() => onChange("config")}>
        <Settings2 className="h-4 w-4" />
        Config
      </Button>
    </>
  );
}

function AccountAvatar({ accountName, accountAvatarUrl }: { accountName?: string; accountAvatarUrl?: string | null }) {
  if (accountAvatarUrl) {
    return <img src={accountAvatarUrl} alt={accountName || "User avatar"} className="h-8 w-8 rounded-full border border-[var(--da-border)] object-cover" />;
  }
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--da-border)] bg-[var(--da-panel)] text-xs font-semibold text-[var(--da-text)]">
      {(accountName?.trim().charAt(0) || "U").toUpperCase()}
    </div>
  );
}

function AuthenticatedAccountPanel({
  accountName,
  accountEmail,
  accountAvatarUrl,
  onLogout,
}: {
  accountName?: string;
  accountEmail?: string;
  accountAvatarUrl?: string | null;
  onLogout: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <AccountAvatar accountName={accountName} accountAvatarUrl={accountAvatarUrl} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--da-text)]">{accountName || "User"}</p>
          <p className="truncate text-xs text-[var(--da-muted)]">{accountEmail || ""}</p>
        </div>
      </div>
      <Button variant="outline" size="sm" className="w-full" onClick={onLogout}>Logout</Button>
    </div>
  );
}

function GuestAccountPanel({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-[var(--da-muted)]">Sign in to save data, edit files, deploy, and push to GitHub.</p>
      <Button size="sm" className="w-full" onClick={onLogin}>Sign in with GitHub</Button>
    </div>
  );
}

function AccountPanel({
  authenticated,
  accountName,
  accountEmail,
  accountAvatarUrl,
  onLogin,
  onLogout,
}: {
  authenticated: boolean;
  accountName?: string;
  accountEmail?: string;
  accountAvatarUrl?: string | null;
  onLogin: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="mt-auto rounded-md border border-[var(--da-border)] bg-[var(--da-elevated)] p-2">
      {authenticated ? <AuthenticatedAccountPanel accountName={accountName} accountEmail={accountEmail} accountAvatarUrl={accountAvatarUrl} onLogout={onLogout} /> : <GuestAccountPanel onLogin={onLogin} />}
    </div>
  );
}

export function WorkspaceSidebar(props: WorkspaceSidebarProps) {
  return (
    <aside className="flex h-full max-h-full min-h-0 flex-col gap-2 border-r border-[var(--da-border)] bg-[var(--da-panel)] p-2">
      <ProjectSwitcher projects={props.projects} currentProject={props.currentProject} currentProjectId={props.currentProjectId} onProjectChange={props.onProjectChange} onCreateProject={props.onCreateProject} onRenameProject={props.onRenameProject} />
      <div className="px-1">
        <ProviderBadge provider={props.currentProject?.provider} />
      </div>
      <WorkspaceTabActions workspaceTab={props.workspaceTab} canOpenConfig={props.canOpenConfig} onChange={props.onChange} />
      <AccountPanel authenticated={props.authenticated} accountName={props.accountName} accountEmail={props.accountEmail} accountAvatarUrl={props.accountAvatarUrl} onLogin={props.onLogin} onLogout={props.onLogout} />
    </aside>
  );
}
