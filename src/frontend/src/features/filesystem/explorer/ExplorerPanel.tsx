import { useRef, type ChangeEvent } from "react";

import { Button } from "../../../components/ui/button";
import type { TreeNode } from "../types";
import { FileTreeNode } from "./FileTreeNode";
import { NewItemInput } from "./NewItemInput";

interface ExplorerPanelProps {
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
}

function ToolbarIcon({ path }: { path: string }) {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
      <path d={path} />
    </svg>
  );
}

function ToolbarButton({
  title,
  disabled,
  onClick,
  iconPath,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  iconPath: string;
}) {
  return (
    <button title={title} className="rounded p-1 text-[var(--da-muted)] hover:bg-[var(--da-panel)] hover:text-[var(--da-text)]" disabled={disabled} onClick={onClick}>
      <ToolbarIcon path={iconPath} />
    </button>
  );
}

function ExplorerToolbar({
  readOnly,
  onRefresh,
  setNewItemMode,
}: {
  readOnly: boolean;
  onRefresh: () => void;
  setNewItemMode: (mode: "file" | "folder" | null) => void;
}) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--da-border)] px-3 py-2">
      <div className="flex gap-1">
        <ToolbarButton title="New file" disabled={readOnly} onClick={() => setNewItemMode("file")} iconPath="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.5L9.5 0H4zm5.5 1v3.5H13L9.5 1zM8 6.5a.5.5 0 0 1 .5.5v1.5H10a.5.5 0 0 1 0 1H8.5V11a.5.5 0 0 1-1 0V9.5H6a.5.5 0 0 1 0-1h1.5V7a.5.5 0 0 1 .5-.5z" />
        <ToolbarButton title="New folder" disabled={readOnly} onClick={() => setNewItemMode("folder")} iconPath="M1.5 3A1.5 1.5 0 0 0 0 4.5v8A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H7.621a1.5 1.5 0 0 1-1.06-.44L5.5 3H1.5zM8 7.5a.5.5 0 0 1 .5.5v1.5H10a.5.5 0 0 1 0 1H8.5V12a.5.5 0 0 1-1 0v-1.5H6a.5.5 0 0 1 0-1h1.5V8a.5.5 0 0 1 .5-.5z" />
        <ToolbarButton title="Refresh" onClick={onRefresh} iconPath="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z" />
      </div>
    </div>
  );
}

function ExplorerNewItemInput({
  readOnly,
  mode,
  onNewFile,
  onNewFolder,
  setMode,
}: {
  readOnly: boolean;
  mode: "file" | "folder" | null;
  onNewFile: (name: string) => void;
  onNewFolder: (name: string) => void;
  setMode: (mode: "file" | "folder" | null) => void;
}) {
  if (readOnly || !mode) return null;
  if (mode === "file") return <NewItemInput placeholder="/path/to/file.txt" onConfirm={onNewFile} onCancel={() => setMode(null)} />;
  return <NewItemInput placeholder="/path/to/folder" onConfirm={onNewFolder} onCancel={() => setMode(null)} />;
}

function EmptyExplorerState({
  readOnly,
  importBusy,
  importError,
  onOpenImportGitHub,
  onOpenZipPicker,
}: {
  readOnly: boolean;
  importBusy: boolean;
  importError: string;
  onOpenImportGitHub: () => void;
  onOpenZipPicker: () => void;
}) {
  return (
    <div className="space-y-3 px-3 py-4">
      <p className="text-center text-xs text-[var(--da-muted)]">No files yet.<br />Import code to get started.</p>
      {readOnly ? null : <div className="space-y-2">
        <Button size="sm" variant="outline" className="w-full" disabled={importBusy} onClick={onOpenImportGitHub}>Import from GitHub</Button>
        <Button size="sm" variant="outline" className="w-full" disabled={importBusy} onClick={onOpenZipPicker}>Upload ZIP</Button>
        {importError ? <p className="text-xs text-red-300">{importError}</p> : null}
      </div>}
    </div>
  );
}

function ExplorerTreeList({
  tree,
  selectedPath,
  readOnly,
  expandedFolders,
  toggleFolder,
  onOpenFile,
  onDelete,
}: {
  tree: TreeNode[];
  selectedPath: string | null;
  readOnly: boolean;
  expandedFolders: Set<string>;
  toggleFolder: (path: string) => void;
  onOpenFile: (path: string) => void;
  onDelete: (path: string, isFolder: boolean) => void;
}) {
  return (
    <>
      {tree.map((node) => (
        <FileTreeNode key={node.path} node={node} depth={0} selectedPath={selectedPath} onSelect={onOpenFile} onDelete={onDelete} readOnly={readOnly} expandedFolders={expandedFolders} toggleFolder={toggleFolder} />
      ))}
    </>
  );
}

export function ExplorerPanel(props: ExplorerPanelProps) {
  const zipInputRef = useRef<HTMLInputElement | null>(null);
  const handleZipChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) props.onUploadZip(file);
    event.currentTarget.value = "";
  };
  return (
    <div className="flex h-full min-h-0 flex-col border-r border-[var(--da-border)] bg-[var(--da-elevated)]">
      <ExplorerToolbar readOnly={props.readOnly} onRefresh={props.onRefresh} setNewItemMode={props.setNewItemMode} />
      <ExplorerNewItemInput readOnly={props.readOnly} mode={props.newItemMode} onNewFile={props.onNewFile} onNewFolder={props.onNewFolder} setMode={props.setNewItemMode} />
      <input ref={zipInputRef} type="file" accept=".zip,application/zip" className="hidden" onChange={handleZipChange} />
      <div className="flex-1 overflow-y-auto py-1">
        {props.tree.length < 1 ? <EmptyExplorerState readOnly={props.readOnly} importBusy={props.importBusy} importError={props.importError} onOpenImportGitHub={props.onOpenImportGitHub} onOpenZipPicker={() => zipInputRef.current?.click()} /> : <ExplorerTreeList tree={props.tree} selectedPath={props.selectedPath} readOnly={props.readOnly} expandedFolders={props.expandedFolders} toggleFolder={props.toggleFolder} onOpenFile={props.onOpenFile} onDelete={props.onDelete} />}
      </div>
    </div>
  );
}
