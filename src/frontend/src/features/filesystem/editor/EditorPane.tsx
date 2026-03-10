import Editor from "@monaco-editor/react";

import type { ProjectGitHubStatus } from "../../../api/projects/index";
import { EditorToolbar } from "./EditorToolbar";

export function EditorPane({
  selectedPath,
  readOnly,
  isDirty,
  isLoading,
  language,
  content,
  setContent,
  exportError,
  workflowError,
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
  isLoading: boolean;
  language: string;
  content: string;
  setContent: (value: string) => void;
  exportError: string;
  workflowError: string;
  githubStatus: ProjectGitHubStatus | null;
  workflowBusy: "plan" | "apply" | null;
  onDownloadZip: () => void;
  onOpenCreateRepo: () => void;
  onOpenPullRequest: () => void;
  onRunWorkflow: (mode: "plan" | "apply") => void;
  onSave: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-[var(--da-panel)]">
      <EditorToolbar
        selectedPath={selectedPath}
        readOnly={readOnly}
        isDirty={isDirty}
        githubStatus={githubStatus}
        workflowBusy={workflowBusy}
        onDownloadZip={onDownloadZip}
        onOpenCreateRepo={onOpenCreateRepo}
        onOpenPullRequest={onOpenPullRequest}
        onRunWorkflow={onRunWorkflow}
        onSave={onSave}
      />

      {exportError && (
        <div className="border-b border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-200">
          {exportError}
        </div>
      )}
      {workflowError && (
        <div className="border-b border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-200">
          {workflowError}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {selectedPath ? (
          isLoading ? (
            <div className="flex h-full items-center justify-center text-xs text-[var(--da-muted)]">
              Loading…
            </div>
          ) : (
            <Editor
              height="100%"
              language={language}
              value={content}
              onChange={(val) => {
                if (!readOnly) setContent(val ?? "");
              }}
              theme="vs-dark"
              options={{
                readOnly,
                fontSize: 12,
                fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: "on",
                lineNumbers: "on",
                renderLineHighlight: "line",
                smoothScrolling: true,
                cursorBlinking: "smooth",
                tabSize: 2,
                padding: { top: 8, bottom: 8 },
              }}
            />
          )
        ) : (
          <div className="flex h-full flex-1 flex-col items-center justify-center gap-2 text-center">
            <svg
              className="h-10 w-10 text-[var(--da-muted)]/30"
              viewBox="0 0 16 16"
              fill="currentColor"
            >
              <path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.5L9.5 0H4zm5.5 1v3.5H13L9.5 1z" />
            </svg>
            <p className="text-xs text-[var(--da-muted)]">Select a file to edit</p>
          </div>
        )}
      </div>
    </div>
  );
}
