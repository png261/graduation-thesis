import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ControlledTreeEnvironment,
  InteractionMode,
  Tree,
  type DraggingPosition,
  type TreeItem,
  type TreeItemIndex,
  type TreeRef,
} from "react-complex-tree";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "../../../components/ui/context-menu";
import type { TreeNode } from "../types";
import { FileTypeIcon } from "./FileTypeIcon";
import { resolveMoveSourcePaths } from "./moveUtils";

interface ExplorerTreeItem {
  id: string;
  path: string;
  name: string;
  type: "file" | "folder";
  children?: ExplorerTreeItem[];
}

export interface PendingCreation {
  id: string;
  parentPath: string;
  mode: "file" | "folder";
}

interface ExplorerTreeListProps {
  tree: TreeNode[];
  selectedPath: string | null;
  selectedPaths: Set<string>;
  readOnly: boolean;
  expandedFolders: Set<string>;
  toggleFolder: (path: string) => void;
  onOpenFile: (path: string) => void;
  onSelectionChange: (paths: string[]) => void;
  onMovePaths: (sourcePaths: string[], destinationDir: string) => Promise<void> | void;
  onRenamePath: (path: string, newName: string) => Promise<void> | void;
  onDelete: (path: string, isFolder: boolean) => void;
  filterQuery: string;
  onRequestCreate: (mode: "file" | "folder", parentPath: string) => void;
  pendingCreation: PendingCreation | null;
  setPendingCreation: (value: PendingCreation | null) => void;
  onCreateAtPath: (mode: "file" | "folder", parentPath: string, name: string) => void;
}

const ROOT_ITEM_ID = "__filesystem_root__";
const TREE_ID = "filesystem-tree";

function toExplorerItem(node: TreeNode): ExplorerTreeItem {
  if (node.type === "file") return { id: node.path, path: node.path, name: node.name, type: "file" };
  return { id: node.path, path: node.path, name: node.name, type: "folder", children: node.children.map(toExplorerItem) };
}

function toPathIndices(indices: TreeItemIndex[]): string[] {
  return indices.map((index) => String(index)).filter((path) => path.startsWith("/"));
}

function buildTreeItems(nodes: ExplorerTreeItem[]): Record<TreeItemIndex, TreeItem<ExplorerTreeItem>> {
  const items: Record<TreeItemIndex, TreeItem<ExplorerTreeItem>> = {
    [ROOT_ITEM_ID]: {
      index: ROOT_ITEM_ID,
      isFolder: true,
      canMove: false,
      canRename: false,
      children: nodes.map((node) => node.path),
      data: { id: ROOT_ITEM_ID, path: "/", name: "root", type: "folder", children: nodes },
    },
  };
  const visit = (node: ExplorerTreeItem) => {
    const isFolder = node.type === "folder";
    items[node.path] = {
      index: node.path,
      isFolder,
      canMove: true,
      canRename: true,
      children: isFolder ? (node.children ?? []).map((child) => child.path) : undefined,
      data: node,
    };
    for (const child of node.children ?? []) visit(child);
  };
  for (const node of nodes) visit(node);
  return items;
}

function withPendingCreation(
  items: Record<TreeItemIndex, TreeItem<ExplorerTreeItem>>,
  pending: PendingCreation | null,
): Record<TreeItemIndex, TreeItem<ExplorerTreeItem>> {
  if (!pending || items[pending.id]) return items;
  const parentIndex = pending.parentPath === "/" ? ROOT_ITEM_ID : pending.parentPath;
  const parentItem = items[parentIndex];
  if (!parentItem?.isFolder) return items;
  const nextItems: Record<TreeItemIndex, TreeItem<ExplorerTreeItem>> = { ...items };
  nextItems[pending.id] = {
    index: pending.id,
    isFolder: pending.mode === "folder",
    canMove: false,
    canRename: true,
    children: pending.mode === "folder" ? [] : undefined,
    data: {
      id: pending.id,
      path: pending.parentPath,
      name: pending.mode === "folder" ? "New folder" : "New file",
      type: pending.mode,
      children: pending.mode === "folder" ? [] : undefined,
    },
  };
  nextItems[parentIndex] = { ...parentItem, children: [pending.id, ...(parentItem.children ?? [])] };
  return nextItems;
}

function baseName(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function parentDir(path: string) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) return "/";
  return `/${parts.slice(0, -1).join("/")}`;
}

function collectFolderPaths(nodes: ExplorerTreeItem[]): string[] {
  const expanded: string[] = [];
  const visit = (node: ExplorerTreeItem) => {
    if (node.type !== "folder") return;
    expanded.push(node.path);
    for (const child of node.children ?? []) visit(child);
  };
  for (const node of nodes) visit(node);
  return expanded;
}

function resolveDropDestination(
  target: DraggingPosition,
  items: Record<TreeItemIndex, TreeItem<ExplorerTreeItem>>,
): string | null {
  if (target.targetType === "root") return "/";
  if (target.targetType === "item") {
    const targetId = String(target.targetItem);
    if (targetId === ROOT_ITEM_ID) return "/";
    const item = items[targetId];
    if (!item?.isFolder) return null;
    return targetId;
  }
  const parentId = String(target.parentItem);
  if (parentId === ROOT_ITEM_ID) return "/";
  const parentItem = items[parentId];
  if (!parentItem?.isFolder) return null;
  return parentId;
}

function FolderIcon() {
  return (
    <svg className="h-3.5 w-3.5 shrink-0 text-amber-500/80" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.5 3A1.5 1.5 0 0 0 0 4.5v8A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H7.621a1.5 1.5 0 0 1-1.06-.44L5.5 3H1.5z" />
    </svg>
  );
}

function rowClassName(isSelected?: boolean) {
  return isSelected
    ? "bg-[var(--da-accent)]/15 text-[var(--da-text)] ring-1 ring-[var(--da-accent)]/45"
    : "text-[var(--da-muted)] hover:bg-[var(--da-elevated)] hover:text-[var(--da-text)]";
}

function moveItemFromPrompt(
  path: string,
  selectedPaths: Set<string>,
  onMovePaths: (sourcePaths: string[], destinationDir: string) => Promise<void> | void,
) {
  const nextDestination = window.prompt("Move to folder", parentDir(path));
  if (!nextDestination || !nextDestination.trim()) return;
  const activeSelection = selectedPaths.has(path) ? selectedPaths : new Set([path]);
  const sourcePaths = resolveMoveSourcePaths([path], activeSelection);
  if (sourcePaths.length < 1) return;
  void onMovePaths(sourcePaths, nextDestination.trim());
}

function makeRenderItem(
  props: ExplorerTreeListProps,
): ({
  item,
  depth,
  children,
  title,
  arrow,
  context,
}: {
  item: TreeItem<ExplorerTreeItem>;
  depth: number;
  children: React.ReactNode | null;
  title: React.ReactNode;
  arrow: React.ReactNode;
  context: {
    isSelected?: boolean;
    isRenaming?: boolean;
    interactiveElementProps: React.HTMLProps<any>;
    itemContainerWithChildrenProps: React.HTMLProps<any>;
    itemContainerWithoutChildrenProps: React.HTMLProps<any>;
    selectItem: () => void;
    startRenamingItem: () => void;
  };
}) => React.ReactElement {
  return ({ item, depth, children, title, arrow, context }) => {
    const data = item.data;
    const isFolder = data.type === "folder";
    const isPendingCreationItem = props.pendingCreation?.id === String(item.index);
    const interactiveProps = context.isRenaming ? undefined : (context.interactiveElementProps as any);
    const interactiveElement = (
      <div
        {...interactiveProps}
        className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-xs ${rowClassName(context.isSelected)}`}
        onContextMenu={(event) => {
          interactiveProps?.onContextMenu?.(event);
          if (!context.isSelected) context.selectItem();
        }}
      >
        <span className="w-4 shrink-0">{arrow}</span>
        {isFolder ? <FolderIcon /> : <FileTypeIcon path={data.path} />}
        {context.isRenaming ? <div className="min-w-0 flex-1">{title}</div> : <span className="min-w-0 flex-1 truncate">{title}</span>}
      </div>
    );
    const createParentPath = isFolder ? data.path : parentDir(data.path);
    const interactiveWithMenu = context.isRenaming || isPendingCreationItem ? interactiveElement : (
      <ContextMenu>
        <ContextMenuTrigger asChild>{interactiveElement}</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuLabel>{data.path}</ContextMenuLabel>
          {!isFolder ? <ContextMenuItem onSelect={() => props.onOpenFile(data.path)}>Open<ContextMenuShortcut>Enter</ContextMenuShortcut></ContextMenuItem> : null}
          <ContextMenuItem disabled={props.readOnly} onSelect={() => context.startRenamingItem()}>Rename<ContextMenuShortcut>F2</ContextMenuShortcut></ContextMenuItem>
          <ContextMenuItem disabled={props.readOnly} onSelect={() => props.onRequestCreate("file", createParentPath)}>New file here</ContextMenuItem>
          <ContextMenuItem disabled={props.readOnly} onSelect={() => props.onRequestCreate("folder", createParentPath)}>New folder here</ContextMenuItem>
          <ContextMenuItem disabled={props.readOnly} onSelect={() => moveItemFromPrompt(data.path, props.selectedPaths, props.onMovePaths)}>Move</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={props.readOnly} className="text-red-300 focus:text-red-200" onSelect={() => props.onDelete(data.path, isFolder)}>
            Delete
            <ContextMenuShortcut>Del</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
    return (
      <li {...(context.itemContainerWithChildrenProps as any)} className="list-none">
        <div {...(context.itemContainerWithoutChildrenProps as any)} style={{ paddingLeft: depth * 16 + 4 }} className="mx-1">
          {interactiveWithMenu}
        </div>
        {children}
      </li>
    );
  };
}

function buildExpandedItemIds(args: {
  explorerTree: ExplorerTreeItem[];
  expandedFolders: Set<string>;
  filterQuery: string;
  pendingCreation: PendingCreation | null;
}) {
  const expanded = args.filterQuery.trim() ? collectFolderPaths(args.explorerTree) : Array.from(args.expandedFolders);
  if (args.pendingCreation?.parentPath && args.pendingCreation.parentPath !== "/" && !expanded.includes(args.pendingCreation.parentPath)) {
    expanded.push(args.pendingCreation.parentPath);
  }
  return expanded;
}

function buildSelectedItemIds(args: {
  availableItemIds: Set<string>;
  selectedPath: string | null;
  selectedPaths: Set<string>;
}) {
  const selectedIds = toPathIndices(Array.from(args.selectedPaths));
  if (selectedIds.length > 0) return selectedIds.filter((id) => args.availableItemIds.has(id));
  if (args.selectedPath && args.availableItemIds.has(args.selectedPath)) return [args.selectedPath];
  return [];
}

function buildViewState(args: {
  pendingCreation: PendingCreation | null;
  selectedItemIds: string[];
  expandedItemIds: string[];
  selectedPath: string | null;
}) {
  return {
    [TREE_ID]: {
      selectedItems: args.pendingCreation ? [args.pendingCreation.id] : args.selectedItemIds,
      expandedItems: args.expandedItemIds,
      focusedItem: args.pendingCreation?.id ?? args.selectedPath ?? args.selectedItemIds[0],
    },
  };
}

function usePendingRenameStart(args: {
  treeRef: React.RefObject<TreeRef<ExplorerTreeItem> | null>;
  items: Record<TreeItemIndex, TreeItem<ExplorerTreeItem>>;
  pendingCreation: PendingCreation | null;
}) {
  const renameStartedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!args.pendingCreation) {
      renameStartedRef.current = null;
      return;
    }
    if (!args.items[args.pendingCreation.id] || renameStartedRef.current === args.pendingCreation.id) return;
    renameStartedRef.current = args.pendingCreation.id;
    requestAnimationFrame(() => {
      args.treeRef.current?.startRenamingItem(args.pendingCreation!.id);
    });
  }, [args.items, args.pendingCreation, args.treeRef]);
}

function useDropHandler(args: {
  readOnly: boolean;
  items: Record<TreeItemIndex, TreeItem<ExplorerTreeItem>>;
  selectedPaths: Set<string>;
  onMovePaths: (sourcePaths: string[], destinationDir: string) => Promise<void> | void;
}) {
  return useCallback((draggedItems: TreeItem<ExplorerTreeItem>[], target: DraggingPosition) => {
    if (args.readOnly) return;
    const destinationDir = resolveDropDestination(target, args.items);
    if (!destinationDir) return;
    const dragIds = draggedItems.map((item) => String(item.index));
    const sourcePaths = resolveMoveSourcePaths(dragIds, args.selectedPaths);
    if (sourcePaths.length < 1) return;
    void args.onMovePaths(sourcePaths, destinationDir);
  }, [args]);
}

function toggleExpandedItem(args: {
  item: TreeItem<ExplorerTreeItem>;
  expandedFolders: Set<string>;
  toggleFolder: (path: string) => void;
  expanded: boolean;
}) {
  const path = String(args.item.index);
  if (!path.startsWith("/")) return;
  if (args.expanded && args.expandedFolders.has(path)) {
    args.toggleFolder(path);
    return;
  }
  if (!args.expanded && !args.expandedFolders.has(path)) args.toggleFolder(path);
}

function handleRenameItem(args: {
  item: TreeItem<ExplorerTreeItem>;
  nextName: string;
  pendingCreation: PendingCreation | null;
  onCreateAtPath: (mode: "file" | "folder", parentPath: string, name: string) => void;
  setPendingCreation: (value: PendingCreation | null) => void;
  onRenamePath: (path: string, newName: string) => Promise<void> | void;
}) {
  const itemId = String(args.item.index);
  if (args.pendingCreation && itemId === args.pendingCreation.id) {
    const createdName = args.nextName.trim();
    if (createdName) args.onCreateAtPath(args.pendingCreation.mode, args.pendingCreation.parentPath, createdName);
    args.setPendingCreation(null);
    return;
  }
  const name = args.nextName.trim();
  if (!name || name === baseName(args.item.data.path)) return;
  void args.onRenamePath(args.item.data.path, name);
}

export function ExplorerTreeList(props: ExplorerTreeListProps) {
  const explorerTree = useMemo(() => props.tree.map(toExplorerItem), [props.tree]);
  const baseItems = useMemo(() => buildTreeItems(explorerTree), [explorerTree]);
  const items = useMemo(() => withPendingCreation(baseItems, props.pendingCreation), [baseItems, props.pendingCreation]);
  const treeRef = useRef<TreeRef<ExplorerTreeItem> | null>(null);
  const availableItemIds = useMemo(() => new Set(Object.keys(items).map((id) => String(id))), [items]);
  const expandedItemIds = useMemo(() => buildExpandedItemIds({
    explorerTree,
    expandedFolders: props.expandedFolders,
    filterQuery: props.filterQuery,
    pendingCreation: props.pendingCreation,
  }), [explorerTree, props.expandedFolders, props.filterQuery, props.pendingCreation]);
  const selectedItemIds = useMemo(() => buildSelectedItemIds({
    availableItemIds,
    selectedPath: props.selectedPath,
    selectedPaths: props.selectedPaths,
  }), [availableItemIds, props.selectedPath, props.selectedPaths]);
  const viewState = useMemo(() => buildViewState({
    pendingCreation: props.pendingCreation,
    selectedItemIds,
    expandedItemIds,
    selectedPath: props.selectedPath,
  }), [expandedItemIds, props.pendingCreation, props.selectedPath, selectedItemIds]);
  usePendingRenameStart({ treeRef, items, pendingCreation: props.pendingCreation });
  const handleDrop = useDropHandler({
    readOnly: props.readOnly,
    items,
    selectedPaths: props.selectedPaths,
    onMovePaths: props.onMovePaths,
  });

  const renderItem = makeRenderItem(props);

  return (
    <div className="h-full w-full">
      <ControlledTreeEnvironment<ExplorerTreeItem>
        items={items}
        getItemTitle={(item) => item.data.name}
        viewState={viewState}
        canDragAndDrop={!props.readOnly}
        canDropOnFolder={!props.readOnly}
        canDropOnNonFolder={false}
        canReorderItems={false}
        canRename={!props.readOnly}
        canSearch
        canSearchByStartingTyping
        defaultInteractionMode={InteractionMode.ClickArrowToExpand}
        renderDepthOffset={16}
        renderItem={renderItem}
        onSelectItems={(indices) => props.onSelectionChange(toPathIndices(indices))}
        onExpandItem={(item) => toggleExpandedItem({ item, expandedFolders: props.expandedFolders, toggleFolder: props.toggleFolder, expanded: false })}
        onCollapseItem={(item) => toggleExpandedItem({ item, expandedFolders: props.expandedFolders, toggleFolder: props.toggleFolder, expanded: true })}
        onPrimaryAction={(item) => {
          if (item.data.type === "file") props.onOpenFile(item.data.path);
        }}
        onRenameItem={(item, nextName) => handleRenameItem({
          item,
          nextName,
          pendingCreation: props.pendingCreation,
          onCreateAtPath: props.onCreateAtPath,
          setPendingCreation: props.setPendingCreation,
          onRenamePath: props.onRenamePath,
        })}
        onAbortRenamingItem={(item) => {
          if (props.pendingCreation && String(item.index) === props.pendingCreation.id) props.setPendingCreation(null);
        }}
        onDrop={handleDrop}
      >
        <Tree ref={treeRef} treeId={TREE_ID} rootItem={ROOT_ITEM_ID} treeLabel="Files" />
      </ControlledTreeEnvironment>
    </div>
  );
}
