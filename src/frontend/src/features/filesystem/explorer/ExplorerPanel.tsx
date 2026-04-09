import { useCallback, useMemo, useRef, useState, type ChangeEvent } from "react";

import { Button } from "../../../components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../../../components/ui/context-menu";
import type { TreeNode } from "../types";
import { ExplorerTreeList, type PendingCreation } from "./ExplorerTreeList";

interface ExplorerPanelProps {
  tree: TreeNode[];
  selectedPath: string | null;
  selectedPaths: Set<string>;
  expandedFolders: Set<string>;
  toggleFolder: (path: string) => void;
  onOpenFile: (path: string) => void;
  onSelectionChange: (paths: string[]) => void;
  onMovePaths: (sourcePaths: string[], destinationDir: string) => Promise<void> | void;
  onRenamePath: (path: string, newName: string) => Promise<void> | void;
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

function filterTreeNodes(nodes: TreeNode[], rawQuery: string): TreeNode[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return nodes;
  const visit = (node: TreeNode): TreeNode | null => {
    const selfMatch = node.name.toLowerCase().includes(query) || node.path.toLowerCase().includes(query);
    if (node.type === "file") return selfMatch ? node : null;
    const children = node.children.map(visit).filter((child): child is TreeNode => child !== null);
    if (!selfMatch && children.length < 1) return null;
    return { ...node, children };
  };
  return nodes.map(visit).filter((node): node is TreeNode => node !== null);
}

function ExplorerFilterInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="border-b border-[var(--da-border)] px-2 py-2">
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Filter files..."
        className="w-full rounded border border-[var(--da-border)] bg-[var(--da-panel)] px-2 py-1 text-xs text-[var(--da-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--da-accent)]/60"
      />
    </div>
  );
}

function EmptyExplorerState({
  importBusy,
  importError,
  onOpenImportGitHub,
  onOpenZipPicker,
}: {
  importBusy: boolean;
  importError: string;
  onOpenImportGitHub: () => void;
  onOpenZipPicker: () => void;
}) {
  return (
    <div className="space-y-3 px-3 py-4">
      <p className="text-center text-xs text-[var(--da-muted)]">
        No files yet.
        <br />
        Import code to get started.
      </p>
    </div>
  );
}

function ExplorerTreeArea(props: {
  tree: TreeNode[];
  filteredTree: TreeNode[];
  pendingCreation: PendingCreation | null;
  panel: ExplorerPanelProps;
  onOpenZipPicker: () => void;
  filterQuery: string;
  onRequestCreate: (mode: "file" | "folder", parentPath: string) => void;
  onCreateAtPath: (mode: "file" | "folder", parentPath: string, name: string) => void;
  setPendingCreation: (value: PendingCreation | null) => void;
}) {
  if (props.tree.length < 1 && !props.pendingCreation) {
    return (
      <EmptyExplorerState
        importBusy={props.panel.importBusy}
        importError={props.panel.importError}
        onOpenImportGitHub={props.panel.onOpenImportGitHub}
        onOpenZipPicker={props.onOpenZipPicker}
      />
    );
  }
  if (props.filteredTree.length < 1 && !props.pendingCreation) {
    return <div className="px-3 py-4 text-xs text-[var(--da-muted)]">No matching files.</div>;
  }
  return (
    <ExplorerTreeList
      tree={props.tree.length < 1 ? [] : props.filteredTree}
      selectedPath={props.panel.selectedPath}
      selectedPaths={props.panel.selectedPaths}
      expandedFolders={props.panel.expandedFolders}
      toggleFolder={props.panel.toggleFolder}
      onOpenFile={props.panel.onOpenFile}
      onSelectionChange={props.panel.onSelectionChange}
      onMovePaths={props.panel.onMovePaths}
      onRenamePath={props.panel.onRenamePath}
      onDelete={props.panel.onDelete}
      filterQuery={props.filterQuery}
      onRequestCreate={props.onRequestCreate}
      pendingCreation={props.pendingCreation}
      setPendingCreation={props.setPendingCreation}
      onCreateAtPath={props.onCreateAtPath}
    />
  );
}

export function ExplorerPanel(props: ExplorerPanelProps) {
  const zipInputRef = useRef<HTMLInputElement | null>(null);
  const nextPendingIdRef = useRef(0);
  const [filterQuery, setFilterQuery] = useState("");
  const [pendingCreation, setPendingCreation] = useState<PendingCreation | null>(null);
  const filteredTree = useMemo(() => filterTreeNodes(props.tree, filterQuery), [filterQuery, props.tree]);

  const toChildPath = useCallback((parentPath: string, name: string) => {
    if (parentPath === "/") return `/${name}`;
    return `${parentPath}/${name}`;
  }, []);

  const handleRequestCreate = useCallback((mode: "file" | "folder", parentPath: string) => {
    const normalizedParent = parentPath && parentPath.trim() ? parentPath : "/";
    const pendingId = `__new__:${mode}:${nextPendingIdRef.current++}`;
    setPendingCreation({ id: pendingId, parentPath: normalizedParent, mode });
  }, []);

  const handleCreateAtPath = useCallback((mode: "file" | "folder", parentPath: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed.includes("/") || trimmed.includes("\\")) return;
    const fullPath = toChildPath(parentPath, trimmed);
    if (mode === "folder") {
      props.onNewFolder(fullPath);
      return;
    }
    props.onNewFile(fullPath);
  }, [props, toChildPath]);

  const handleZipChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) props.onUploadZip(file);
    event.currentTarget.value = "";
  };

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-[var(--da-border)] bg-[var(--da-elevated)]">
      <ExplorerFilterInput value={filterQuery} onChange={setFilterQuery} />
      <input ref={zipInputRef} type="file" accept=".zip,application/zip" className="hidden" onChange={handleZipChange} />
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="flex-1 overflow-y-auto py-1">
            <ExplorerTreeArea
              tree={props.tree}
              filteredTree={filteredTree}
              pendingCreation={pendingCreation}
              panel={props}
              onOpenZipPicker={() => zipInputRef.current?.click()}
              filterQuery={filterQuery}
              onRequestCreate={handleRequestCreate}
              onCreateAtPath={handleCreateAtPath}
              setPendingCreation={setPendingCreation}
            />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => handleRequestCreate("file", "/")}>New file</ContextMenuItem>
          <ContextMenuItem onSelect={() => handleRequestCreate("folder", "/")}>New folder</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={props.onRefresh}>Refresh</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}
