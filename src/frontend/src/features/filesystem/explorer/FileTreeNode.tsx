import { useState } from "react";

import type { TreeNode } from "../types";
import { FileTypeIcon } from "./FileTypeIcon";

export function FileTreeNode({
  node,
  depth,
  selectedPath,
  readOnly,
  onSelect,
  onDelete,
  expandedFolders,
  toggleFolder,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  readOnly: boolean;
  onSelect: (path: string) => void;
  onDelete: (path: string, isFolder: boolean) => void;
  expandedFolders: Set<string>;
  toggleFolder: (path: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const indent = depth * 12;

  if (node.type === "folder") {
    const expanded = expandedFolders.has(node.path);
    return (
      <div>
        <div
          className="group flex cursor-pointer items-center gap-1 rounded px-1 py-1 text-xs hover:bg-[var(--da-elevated)]"
          style={{ paddingLeft: indent + 4 }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={() => toggleFolder(node.path)}
        >
          <svg
            className="h-3 w-3 shrink-0 text-[var(--da-muted)] transition-transform"
            style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M6 3l6 5-6 5V3z" />
          </svg>
          <svg
            className="h-3.5 w-3.5 shrink-0 text-amber-500/80"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M1.5 3A1.5 1.5 0 0 0 0 4.5v8A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H7.621a1.5 1.5 0 0 1-1.06-.44L5.5 3H1.5z" />
          </svg>
          <span className="min-w-0 flex-1 truncate font-medium text-[var(--da-muted)]">{node.name}</span>
          {hovered && !readOnly && (
            <button
              className="shrink-0 rounded p-0.5 text-[var(--da-muted)] hover:bg-red-500/20 hover:text-red-300"
              title="Delete folder and its contents"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(node.path, true);
              }}
            >
              <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
                <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z" />
                <path
                  fillRule="evenodd"
                  d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"
                />
              </svg>
            </button>
          )}
        </div>
        {expanded && (
          <div>
            {node.children.map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
                onDelete={onDelete}
                readOnly={readOnly}
                expandedFolders={expandedFolders}
                toggleFolder={toggleFolder}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const isSelected = node.path === selectedPath;
  return (
    <div
      className={`group flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-xs ${
        isSelected
          ? "bg-[var(--da-accent)]/15 text-[var(--da-text)] ring-1 ring-[var(--da-accent)]/45"
          : "text-[var(--da-muted)] hover:bg-[var(--da-elevated)] hover:text-[var(--da-text)]"
      }`}
      style={{ paddingLeft: indent + 4 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onSelect(node.path)}
    >
      <FileTypeIcon path={node.path} />
      <span className="min-w-0 flex-1 truncate">{node.name}</span>
      {hovered && !readOnly && (
        <button
          className="shrink-0 rounded p-0.5 text-[var(--da-muted)] hover:bg-red-500/20 hover:text-red-300"
          title="Delete file"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(node.path, false);
          }}
        >
          <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
            <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z" />
            <path
              fillRule="evenodd"
              d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
