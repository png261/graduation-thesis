import type { PathMove } from "../../../api/projects";

export type DropTargetKind = "root" | "folder" | "file";

function uniquePaths(paths: string[]) {
  return [...new Set(paths.filter((path) => path.trim().length > 0))];
}

function remapPathBySingleMove(path: string, move: PathMove): string {
  if (path === move.from) return move.to;
  const prefix = `${move.from}/`;
  if (!path.startsWith(prefix)) return path;
  return `${move.to}${path.slice(move.from.length)}`;
}

export function remapMovedPath(path: string | null, moved: PathMove[]): string | null {
  if (!path) return path;
  let next = path;
  const orderedMoves = [...moved].sort((left, right) => right.from.length - left.from.length);
  for (const move of orderedMoves) {
    next = remapPathBySingleMove(next, move);
  }
  return next;
}

export function remapMovedPathSet(paths: Set<string>, moved: PathMove[]): Set<string> {
  const remapped = new Set<string>();
  for (const path of paths) {
    const next = remapMovedPath(path, moved);
    if (next) remapped.add(next);
  }
  return remapped;
}

export function resolveMoveSourcePaths(dragIds: string[], selectedPaths: Set<string>): string[] {
  const dragged = uniquePaths(dragIds);
  if (dragged.length < 1) return [];
  const draggedSet = new Set(dragged);
  const selected = uniquePaths(Array.from(selectedPaths));
  if (selected.some((path) => draggedSet.has(path))) return selected;
  return dragged;
}

export function isDropTargetAllowed(kind: DropTargetKind): boolean {
  return kind !== "file";
}
