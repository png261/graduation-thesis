import { ChevronDown, MessageSquareText, Settings2 } from "lucide-react";

import { Button } from "../../components/ui/button";
import type { Project } from "../../api/projects";
import type { AuthProvider } from "../../contexts/AuthContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { ProviderBadge } from "../project-config";

export function WorkspaceSidebar({
  projects,
  currentProject,
  currentProjectId,
  authenticated,
  canOpenConfig,
  accountName,
  accountEmail,
  accountAvatarUrl,
  onProjectChange,
  onCreateProject,
  onRenameProject,
  onLogin,
  onLogout,
  workspaceTab,
  onChange,
}: {
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
  onLogin: (provider: AuthProvider) => void;
  onLogout: () => void;
  workspaceTab: "view" | "config";
  onChange: (tab: "view" | "config") => void;
}) {
  return (
    <aside className="flex h-full max-h-full min-h-0 flex-col gap-2 border-r border-[var(--da-border)] bg-[var(--da-panel)] p-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="h-11 w-full justify-between">
            <span className="truncate">{currentProject?.name || "Select project"}</span>
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel>Projects</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup value={currentProjectId} onValueChange={onProjectChange}>
            {projects.map((project) => (
              <DropdownMenuRadioItem key={project.id} value={project.id}>
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="truncate">{project.name}</span>
                  <ProviderBadge provider={project.provider} />
                </div>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onCreateProject}>Create Project</DropdownMenuItem>
          <DropdownMenuItem onSelect={onRenameProject}>Rename Current Project</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="px-1">
        <ProviderBadge provider={currentProject?.provider} />
      </div>

      <Button
        variant={workspaceTab === "view" ? "default" : "ghost"}
        className="justify-start gap-2"
        onClick={() => onChange("view")}
      >
        <MessageSquareText className="h-4 w-4" />
        Chat
      </Button>
      <Button
        variant={workspaceTab === "config" ? "default" : "ghost"}
        className="justify-start gap-2"
        disabled={!canOpenConfig}
        onClick={() => onChange("config")}
      >
        <Settings2 className="h-4 w-4" />
        Config
      </Button>

      <div className="mt-auto rounded-md border border-[var(--da-border)] bg-[var(--da-elevated)] p-2">
        {authenticated ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {accountAvatarUrl ? (
                <img
                  src={accountAvatarUrl}
                  alt={accountName || "User avatar"}
                  className="h-8 w-8 rounded-full border border-[var(--da-border)] object-cover"
                />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--da-border)] bg-[var(--da-panel)] text-xs font-semibold text-[var(--da-text)]">
                  {(accountName?.trim().charAt(0) || "U").toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--da-text)]">{accountName || "User"}</p>
                <p className="truncate text-xs text-[var(--da-muted)]">{accountEmail || ""}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" className="w-full" onClick={onLogout}>
              Logout
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-[var(--da-muted)]">
              Sign in to save data, edit files, deploy, and push to GitHub.
            </p>
            <Button size="sm" className="w-full" onClick={() => onLogin("google")}>
              Sign in with Google
            </Button>
            <Button variant="outline" size="sm" className="w-full" onClick={() => onLogin("github")}>
              Sign in with GitHub
            </Button>
          </div>
        )}
      </div>
    </aside>
  );
}
