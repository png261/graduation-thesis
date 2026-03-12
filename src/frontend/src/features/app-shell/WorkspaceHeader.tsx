import { ChevronDown, Download, GitPullRequest, Github, Play, Zap } from "lucide-react";
import type { ReactNode } from "react";

import type { Project, ProjectGitHubStatus } from "../../api/projects";
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
  readOnly: boolean;
  githubStatus: ProjectGitHubStatus | null;
  workflowBusy: "plan" | "apply" | "pipeline" | null;
  onDownloadZip: () => void;
  onOpenCreateRepo: () => void;
  onOpenPullRequest: () => void;
  onRunWorkflow: (mode: "plan" | "apply" | "pipeline") => void;
}

function HeaderMenuItem({
  icon,
  title,
  description,
  disabled,
  onSelect,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem className="items-start gap-3 py-2" disabled={disabled} onSelect={onSelect}>
      {icon}
      <div className="min-w-0">
        <p className="font-medium text-[var(--da-text)]">{title}</p>
        <p className="text-xs text-[var(--da-muted)]">{description}</p>
      </div>
    </DropdownMenuItem>
  );
}

function ProjectPickerMenu({
  projects,
  currentProjectId,
  onProjectChange,
  onCreateProject,
  onRenameProject,
}: Pick<WorkspaceHeaderProps, "projects" | "currentProjectId" | "onProjectChange" | "onCreateProject" | "onRenameProject">) {
  return (
    <DropdownMenuContent align="start" className="w-80">
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
      <Button variant="ghost" className="h-9 min-w-[280px] justify-between px-2 text-base font-semibold">
        <span className="truncate">{projectName}</span>
        <ChevronDown className="h-4 w-4 text-[var(--da-muted)]" />
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
}: Pick<WorkspaceHeaderProps, "projects" | "currentProject" | "currentProjectId" | "onProjectChange" | "onCreateProject" | "onRenameProject">) {
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

function HeaderExportCodeMenu({
  readOnly,
  githubStatus,
  onDownloadZip,
  onOpenCreateRepo,
  onOpenPullRequest,
}: Pick<WorkspaceHeaderProps, "readOnly" | "githubStatus" | "onDownloadZip" | "onOpenCreateRepo" | "onOpenPullRequest">) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5 border-white/20 bg-black/20 hover:bg-black/35">
          Export Code
          <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Export Code</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <HeaderMenuItem icon={<Download className="mt-0.5 h-4 w-4" />} title="Download as Zip" description="Get the latest code version" disabled={readOnly} onSelect={onDownloadZip} />
        <HeaderMenuItem icon={<Github className="mt-0.5 h-4 w-4" />} title="Create GitHub Repository" description={githubStatus?.connected ? "Project is already connected to a repository" : "Export to a new repository and connect automatically"} disabled={readOnly || Boolean(githubStatus?.connected)} onSelect={onOpenCreateRepo} />
        <HeaderMenuItem icon={<GitPullRequest className="mt-0.5 h-4 w-4" />} title="Create Pull Request" description={githubStatus?.connected ? "Commit local changes and open a pull request" : "Connect this project to GitHub first"} disabled={readOnly || !githubStatus?.connected} onSelect={onOpenPullRequest} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function workflowButtonLabel(workflowBusy: "plan" | "apply" | "pipeline" | null) {
  if (workflowBusy === "plan") return "Planning...";
  if (workflowBusy === "apply") return "Applying...";
  if (workflowBusy === "pipeline") return "Running Pipeline...";
  return "Run Workflow";
}

function HeaderWorkflowMenu({
  readOnly,
  workflowBusy,
  onRunWorkflow,
}: Pick<WorkspaceHeaderProps, "readOnly" | "workflowBusy" | "onRunWorkflow">) {
  const disabled = readOnly || workflowBusy !== null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="h-9 gap-1.5" disabled={disabled}>
          {workflowButtonLabel(workflowBusy)}
          <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Run Workflow</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <HeaderMenuItem icon={<Play className="mt-0.5 h-4 w-4" />} title="Run Plan" description="init + plan" disabled={disabled} onSelect={() => onRunWorkflow("plan")} />
        <HeaderMenuItem icon={<Zap className="mt-0.5 h-4 w-4" />} title="Run Apply" description="init + apply" disabled={disabled} onSelect={() => onRunWorkflow("apply")} />
        <HeaderMenuItem icon={<Zap className="mt-0.5 h-4 w-4" />} title="Run Pipeline" description="apply + ansible + telegram report" disabled={disabled} onSelect={() => onRunWorkflow("pipeline")} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function WorkspaceHeader(props: WorkspaceHeaderProps) {
  return (
    <header className="border-b border-white/10 bg-[#0b0d12] px-4 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <ProjectPicker
          projects={props.projects}
          currentProject={props.currentProject}
          currentProjectId={props.currentProjectId}
          onProjectChange={props.onProjectChange}
          onCreateProject={props.onCreateProject}
          onRenameProject={props.onRenameProject}
        />
        <div className="flex items-center gap-2">
          <HeaderExportCodeMenu
            readOnly={props.readOnly}
            githubStatus={props.githubStatus}
            onDownloadZip={props.onDownloadZip}
            onOpenCreateRepo={props.onOpenCreateRepo}
            onOpenPullRequest={props.onOpenPullRequest}
          />
          <HeaderWorkflowMenu readOnly={props.readOnly} workflowBusy={props.workflowBusy} onRunWorkflow={props.onRunWorkflow} />
        </div>
      </div>
    </header>
  );
}
