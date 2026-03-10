import { useRef } from "react";

import { Button } from "../../../components/ui/button";
import { FileTreeNode } from "./FileTreeNode";
import { NewItemInput } from "./NewItemInput";
import type { TreeNode } from "../types";

export function ExplorerPanel({
  tree,
  selectedPath,
  readOnly,
  expandedFolders,
  toggleFolder,
  onOpenFile,
  onDelete,
  onRefresh,
  newItemMode,
  setNewItemMode,
  onNewFile,
  onNewFolder,
  onOpenImportGitHub,
  onUploadZip,
  importBusy,
  importError,
}: {
  tree: TreeNode[];
  selectedPath: string | null;
  readOnly: boolean;
  expandedFolders: Set<string>;
  toggleFolder: (path: string) => void;
  onOpenFile: (path: string) => void;
  onDelete: (path: string, isFolder: boolean) => void;
  onRefresh: () => void;
  newItemMode: "file" | "folder" | null;
  setNewItemMode: (mode: "file" | "folder" | null) => void;
  onNewFile: (name: string) => void;
  onNewFolder: (name: string) => void;
  onOpenImportGitHub: () => void;
  onUploadZip: (file: File) => void;
  importBusy: boolean;
  importError: string;
}) {
  const zipInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-[var(--da-border)] bg-[var(--da-elevated)]">
      <div className="flex items-center justify-between border-b border-[var(--da-border)] px-3 py-2">
        <div className="flex gap-1">
          <button
            title="New file"
            className="rounded p-1 text-[var(--da-muted)] hover:bg-[var(--da-panel)] hover:text-[var(--da-text)]"
            disabled={readOnly}
            onClick={() => setNewItemMode("file")}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.5L9.5 0H4zm5.5 1v3.5H13L9.5 1zM8 6.5a.5.5 0 0 1 .5.5v1.5H10a.5.5 0 0 1 0 1H8.5V11a.5.5 0 0 1-1 0V9.5H6a.5.5 0 0 1 0-1h1.5V7a.5.5 0 0 1 .5-.5z" />
            </svg>
          </button>
          <button
            title="New folder"
            className="rounded p-1 text-[var(--da-muted)] hover:bg-[var(--da-panel)] hover:text-[var(--da-text)]"
            disabled={readOnly}
            onClick={() => setNewItemMode("folder")}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1.5 3A1.5 1.5 0 0 0 0 4.5v8A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H7.621a1.5 1.5 0 0 1-1.06-.44L5.5 3H1.5zM8 7.5a.5.5 0 0 1 .5.5v1.5H10a.5.5 0 0 1 0 1H8.5V12a.5.5 0 0 1-1 0v-1.5H6a.5.5 0 0 1 0-1h1.5V8a.5.5 0 0 1 .5-.5z" />
            </svg>
          </button>
          <button
            title="Refresh"
            className="rounded p-1 text-[var(--da-muted)] hover:bg-[var(--da-panel)] hover:text-[var(--da-text)]"
            onClick={onRefresh}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"
              />
              <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z" />
            </svg>
          </button>
        </div>
      </div>

      {!readOnly && newItemMode === "file" && (
        <NewItemInput
          placeholder="/path/to/file.txt"
          onConfirm={onNewFile}
          onCancel={() => setNewItemMode(null)}
        />
      )}
      {!readOnly && newItemMode === "folder" && (
        <NewItemInput
          placeholder="/path/to/folder"
          onConfirm={onNewFolder}
          onCancel={() => setNewItemMode(null)}
        />
      )}

      <div className="flex-1 overflow-y-auto py-1">
        {tree.length === 0 ? (
          <div className="space-y-3 px-3 py-4">
            <p className="text-center text-xs text-[var(--da-muted)]">
              No files yet.
              <br />
              Import code to get started.
            </p>
            {!readOnly && (
              <div className="space-y-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  disabled={importBusy}
                  onClick={onOpenImportGitHub}
                >
                  Import from GitHub
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  disabled={importBusy}
                  onClick={() => zipInputRef.current?.click()}
                >
                  Upload ZIP
                </Button>
                <input
                  ref={zipInputRef}
                  type="file"
                  accept=".zip,application/zip"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) onUploadZip(file);
                    event.currentTarget.value = "";
                  }}
                />
                {importError && (
                  <p className="text-xs text-red-300">{importError}</p>
                )}
              </div>
            )}
          </div>
        ) : (
          tree.map((node) => (
            <FileTreeNode
              key={node.path}
              node={node}
              depth={0}
              selectedPath={selectedPath}
              onSelect={onOpenFile}
              onDelete={onDelete}
              readOnly={readOnly}
              expandedFolders={expandedFolders}
              toggleFolder={toggleFolder}
            />
          ))
        )}
      </div>
    </div>
  );
}
