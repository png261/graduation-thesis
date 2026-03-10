import { ChevronDown } from "lucide-react";

import type { Project } from "../../api/projects";
import { Button } from "../../components/ui/button";
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

export function WorkspaceHeader({
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
    <header className="sticky top-0 z-20 border-b border-[var(--da-border)] bg-[var(--da-bg)]/95 px-3 py-3 backdrop-blur md:px-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="min-w-[220px] justify-between">
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
          <ProviderBadge provider={currentProject?.provider} />
        </div>
      </div>
    </header>
  );
}
