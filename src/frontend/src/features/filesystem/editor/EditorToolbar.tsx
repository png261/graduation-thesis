import { ChevronDown, Download, GitPullRequest, Github, Play, Zap } from "lucide-react";
import type { ReactNode } from "react";

import type { ProjectGitHubStatus } from "../../../api/projects/index";
import { Button } from "../../../components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "../../../components/ui/dropdown-menu";

interface EditorToolbarProps {
  selectedPath: string | null;
  readOnly: boolean;
  isDirty: boolean;
  githubStatus: ProjectGitHubStatus | null;
  workflowBusy: "plan" | "apply" | null;
  onDownloadZip: () => void;
  onOpenCreateRepo: () => void;
  onOpenPullRequest: () => void;
  onRunWorkflow: (mode: "plan" | "apply") => void;
  onSave: () => void;
}

function ToolbarFileStatus({ selectedPath, isDirty }: { selectedPath: string | null; isDirty: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="font-mono text-[var(--da-text)]">{selectedPath ?? "No file selected"}</span>
      {isDirty && selectedPath ? <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title="Unsaved changes" /> : null}
    </div>
  );
}

function ToolbarMenuItem({
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

function ExportCodeMenu({
  readOnly,
  githubStatus,
  onDownloadZip,
  onOpenCreateRepo,
  onOpenPullRequest,
}: {
  readOnly: boolean;
  githubStatus: ProjectGitHubStatus | null;
  onDownloadZip: () => void;
  onOpenCreateRepo: () => void;
  onOpenPullRequest: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5">Export Code<ChevronDown className="h-4 w-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Export Code</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <ToolbarMenuItem icon={<Download className="mt-0.5 h-4 w-4" />} title="Download as Zip" description="Get the latest code version" disabled={readOnly} onSelect={onDownloadZip} />
        <ToolbarMenuItem icon={<Github className="mt-0.5 h-4 w-4" />} title="Create GitHub Repository" description={githubStatus?.connected ? "Project is already connected to a repository" : "Export to a new repository and connect automatically"} disabled={readOnly || Boolean(githubStatus?.connected)} onSelect={onOpenCreateRepo} />
        <ToolbarMenuItem icon={<GitPullRequest className="mt-0.5 h-4 w-4" />} title="Create Pull Request" description={githubStatus?.connected ? "Commit local changes and open a pull request" : "Connect this project to GitHub first"} disabled={readOnly || !githubStatus?.connected} onSelect={onOpenPullRequest} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function workflowButtonLabel(workflowBusy: "plan" | "apply" | null) {
  if (workflowBusy === "plan") return "Planning...";
  if (workflowBusy === "apply") return "Applying...";
  return "Run Workflow";
}

function WorkflowMenu({
  readOnly,
  workflowBusy,
  onRunWorkflow,
}: {
  readOnly: boolean;
  workflowBusy: "plan" | "apply" | null;
  onRunWorkflow: (mode: "plan" | "apply") => void;
}) {
  const disabled = readOnly || workflowBusy !== null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="h-8 gap-1.5" disabled={disabled}>{workflowButtonLabel(workflowBusy)}<ChevronDown className="h-4 w-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Run Workflow</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <ToolbarMenuItem icon={<Play className="mt-0.5 h-4 w-4" />} title="Run Plan" description="init + plan" disabled={disabled} onSelect={() => onRunWorkflow("plan")} />
        <ToolbarMenuItem icon={<Zap className="mt-0.5 h-4 w-4" />} title="Run Apply" description="init + apply" disabled={disabled} onSelect={() => onRunWorkflow("apply")} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SaveButton({
  readOnly,
  selectedPath,
  isDirty,
  onSave,
}: {
  readOnly: boolean;
  selectedPath: string | null;
  isDirty: boolean;
  onSave: () => void;
}) {
  return (
    <Button size="sm" className="h-8" variant={isDirty ? "default" : "secondary"} onClick={onSave} disabled={readOnly || !selectedPath || !isDirty}>
      Save
    </Button>
  );
}

export function EditorToolbar(props: EditorToolbarProps) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--da-border)] bg-[var(--da-panel)] px-3 py-1.5">
      <ToolbarFileStatus selectedPath={props.selectedPath} isDirty={props.isDirty} />
      <div className="flex items-center gap-2">
        <ExportCodeMenu readOnly={props.readOnly} githubStatus={props.githubStatus} onDownloadZip={props.onDownloadZip} onOpenCreateRepo={props.onOpenCreateRepo} onOpenPullRequest={props.onOpenPullRequest} />
        <WorkflowMenu readOnly={props.readOnly} workflowBusy={props.workflowBusy} onRunWorkflow={props.onRunWorkflow} />
        <SaveButton readOnly={props.readOnly} selectedPath={props.selectedPath} isDirty={props.isDirty} onSave={props.onSave} />
      </div>
    </div>
  );
}
