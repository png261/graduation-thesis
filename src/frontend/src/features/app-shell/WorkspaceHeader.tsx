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

interface WorkspaceHeaderProps {
  projects: Project[];
  currentProject: Project | undefined;
  currentProjectId: string;
  onProjectChange: (id: string) => void;
  onCreateProject: () => void;
  onRenameProject: () => void;
}

function ProjectPickerMenu({
  projects,
  currentProjectId,
  onProjectChange,
  onCreateProject,
  onRenameProject,
}: Omit<WorkspaceHeaderProps, "currentProject">) {
  return (
    <DropdownMenuContent align="start" className="w-72">
      <DropdownMenuLabel>Projects</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuRadioGroup value={currentProjectId} onValueChange={onProjectChange}>
        {projects.map((project) => <ProjectMenuItem key={project.id} project={project} />)}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onCreateProject}>Create Project</DropdownMenuItem>
      <DropdownMenuItem onSelect={onRenameProject}>Rename Current Project</DropdownMenuItem>
    </DropdownMenuContent>
  );
}

function ProjectPickerTrigger({ projectName }: { projectName: string }) {
  return (
    <DropdownMenuTrigger asChild>
      <Button variant="outline" className="min-w-[220px] justify-between">
        <span className="truncate">{projectName}</span>
        <ChevronDown className="h-4 w-4" />
      </Button>
    </DropdownMenuTrigger>
  );
}

function ProjectPicker({
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
      <ProjectPickerTrigger projectName={currentProject?.name || "Select project"} />
      <ProjectPickerMenu
        projects={projects}
        currentProjectId={currentProjectId}
        onProjectChange={onProjectChange}
        onCreateProject={onCreateProject}
        onRenameProject={onRenameProject}
      />
    </DropdownMenu>
  );
}

function ProjectMenuItem({ project }: { project: Project }) {
  return (
    <DropdownMenuRadioItem value={project.id}>
      <div className="flex w-full items-center justify-between gap-2">
        <span className="truncate">{project.name}</span>
        <ProviderBadge provider={project.provider} />
      </div>
    </DropdownMenuRadioItem>
  );
}

export function WorkspaceHeader(props: WorkspaceHeaderProps) {
  const { projects, currentProject, currentProjectId, onProjectChange, onCreateProject, onRenameProject } = props;
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--da-border)] bg-[var(--da-bg)]/95 px-3 py-3 backdrop-blur md:px-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ProjectPicker
            projects={projects}
            currentProject={currentProject}
            currentProjectId={currentProjectId}
            onProjectChange={onProjectChange}
            onCreateProject={onCreateProject}
            onRenameProject={onRenameProject}
          />
          <ProviderBadge provider={currentProject?.provider} />
        </div>
      </div>
    </header>
  );
}
