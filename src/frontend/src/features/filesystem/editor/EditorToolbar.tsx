import { ChevronDown, Download, GitPullRequest, Github, Play, Zap } from "lucide-react";

import { Button } from "../../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import type { ProjectGitHubStatus } from "../../../api/projects/index";

export function EditorToolbar({
  selectedPath,
  readOnly,
  isDirty,
  githubStatus,
  workflowBusy,
  onDownloadZip,
  onOpenCreateRepo,
  onOpenPullRequest,
  onRunWorkflow,
  onSave,
}: {
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
}) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--da-border)] bg-[var(--da-panel)] px-3 py-1.5">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-mono text-[var(--da-text)]">{selectedPath ?? "No file selected"}</span>
        {isDirty && selectedPath && (
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title="Unsaved changes" />
        )}
      </div>

      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5">
              Export Code
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel>Export Code</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="items-start gap-3 py-2"
              disabled={readOnly}
              onSelect={onDownloadZip}
            >
              <Download className="mt-0.5 h-4 w-4" />
              <div className="min-w-0">
                <p className="font-medium text-[var(--da-text)]">Download as Zip</p>
                <p className="text-xs text-[var(--da-muted)]">Get the latest code version</p>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="items-start gap-3 py-2"
              disabled={readOnly || Boolean(githubStatus?.connected)}
              onSelect={onOpenCreateRepo}
            >
              <Github className="mt-0.5 h-4 w-4" />
              <div className="min-w-0">
                <p className="font-medium text-[var(--da-text)]">Create GitHub Repository</p>
                <p className="text-xs text-[var(--da-muted)]">
                  {githubStatus?.connected
                    ? "Project is already connected to a repository"
                    : "Export to a new repository and connect automatically"}
                </p>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="items-start gap-3 py-2"
              disabled={readOnly || !githubStatus?.connected}
              onSelect={onOpenPullRequest}
            >
              <GitPullRequest className="mt-0.5 h-4 w-4" />
              <div className="min-w-0">
                <p className="font-medium text-[var(--da-text)]">Create Pull Request</p>
                <p className="text-xs text-[var(--da-muted)]">
                  {githubStatus?.connected
                    ? "Commit local changes and open a pull request"
                    : "Connect this project to GitHub first"}
                </p>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="h-8 gap-1.5" disabled={readOnly || workflowBusy !== null}>
              {workflowBusy === "plan"
                ? "Planning..."
                : workflowBusy === "apply"
                  ? "Applying..."
                  : "Run Workflow"}
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel>Run Workflow</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="items-start gap-3 py-2"
              disabled={readOnly || workflowBusy !== null}
              onSelect={() => onRunWorkflow("plan")}
            >
              <Play className="mt-0.5 h-4 w-4" />
              <div className="min-w-0">
                <p className="font-medium text-[var(--da-text)]">Run Plan</p>
                <p className="text-xs text-[var(--da-muted)]">init + plan</p>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="items-start gap-3 py-2"
              disabled={readOnly || workflowBusy !== null}
              onSelect={() => onRunWorkflow("apply")}
            >
              <Zap className="mt-0.5 h-4 w-4" />
              <div className="min-w-0">
                <p className="font-medium text-[var(--da-text)]">Run Apply</p>
                <p className="text-xs text-[var(--da-muted)]">init + apply</p>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          size="sm"
          className="h-8"
          variant={isDirty ? "default" : "secondary"}
          onClick={onSave}
          disabled={readOnly || !selectedPath || !isDirty}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
