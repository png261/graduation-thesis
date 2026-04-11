import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import {
  deleteProjectFile,
  listProjectFiles,
  moveProjectPaths,
  renameProjectPath,
  readProjectFile,
  writeProjectFile,
  type FileEntry,
  type PathMove,
} from "../api/projects";
import { remapMovedPath } from "../features/filesystem/explorer/moveUtils";

export type { FileEntry };

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"]);

export interface UseFilesystemReturn {
  files: FileEntry[];
  selectedPath: string | null;
  content: string;
  isDirty: boolean;
  isLoading: boolean;
  fetchFiles: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  saveFile: (path: string, content: string) => Promise<void>;
  deleteFile: (path: string) => Promise<void>;
  createFile: (path: string, content?: string) => Promise<void>;
  movePaths: (sourcePaths: string[], destinationDir: string) => Promise<PathMove[]>;
  renamePath: (path: string, newName: string) => Promise<PathMove | null>;
  followFile: (path: string, previewContent?: string) => Promise<void>;
  setContent: (content: string) => void;
}

interface UseFilesystemOptions {
  authenticated: boolean;
  readOnly: boolean;
}

function normalizePath(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
}

function extensionFromPath(path: string): string {
  const name = path.split("/").pop() ?? path;
  const index = name.lastIndexOf(".");
  if (index < 0 || index === name.length - 1) return "";
  return name.slice(index + 1).toLowerCase();
}

function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionFromPath(path));
}

function setSelectedFileState(
  path: string,
  value: string,
  setSelectedPath: Dispatch<SetStateAction<string | null>>,
  setContentState: Dispatch<SetStateAction<string>>,
  setSavedContent: Dispatch<SetStateAction<string>>,
) {
  setSelectedPath(path);
  setContentState(value);
  setSavedContent(value);
}

function clearSelectedFileState(
  setSelectedPath: Dispatch<SetStateAction<string | null>>,
  setContentState: Dispatch<SetStateAction<string>>,
  setSavedContent: Dispatch<SetStateAction<string>>,
) {
  setSelectedPath(null);
  setContentState("");
  setSavedContent("");
}

function useFilesystemState() {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContentState] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  return {files, selectedPath, content, savedContent, isLoading, setFiles, setSelectedPath, setSelectedFileState, setContentState, setSavedContent, setIsLoading}
}

type FilesystemState = ReturnType<typeof useFilesystemState>;

function useFetchFilesAction(projectId: string, authenticated: boolean, state: FilesystemState) {
  return useCallback(async () => {
    if (!projectId) return;
    try {
      state.setFiles(await listProjectFiles(projectId));
    } catch {
      // non-fatal
    }
  }, [authenticated, projectId, state.selectedPath, state.setContentState, state.setFiles, state.setSavedContent, state.setSelectedPath]);
}

function useOpenFileAction(projectId: string, authenticated: boolean, state: FilesystemState) {
  return useCallback(async (path: string) => {
    state.setIsLoading(true);
    try {
      if (!authenticated) {
        setSelectedFileState(path, "", state.setSelectedPath, state.setContentState, state.setSavedContent);
        return;
      }
      if (isImagePath(path)) {
        setSelectedFileState(path, "", state.setSelectedPath, state.setContentState, state.setSavedContent);
        return;
      }
      const data = await readProjectFile(projectId, path);
      setSelectedFileState(path, data, state.setSelectedPath, state.setContentState, state.setSavedContent);
    } catch {
      // non-fatal
    } finally {
      state.setIsLoading(false);
    }
  }, [authenticated, projectId, state]);
}

function useFollowFileAction(projectId: string, authenticated: boolean, state: FilesystemState) {
  return useCallback(async (path: string, previewContent?: string) => {
    if (typeof previewContent === "string") {
      setSelectedFileState(path, previewContent, state.setSelectedPath, state.setContentState, state.setSavedContent);
      state.setIsLoading(false);
      return;
    }
    state.setIsLoading(true);
    try {
      if (!authenticated || isImagePath(path)) {
        setSelectedFileState(path, "", state.setSelectedPath, state.setContentState, state.setSavedContent);
        return;
      }
      const data = await readProjectFile(projectId, path).catch(() => "");
      setSelectedFileState(path, data, state.setSelectedPath, state.setContentState, state.setSavedContent);
    } finally {
      state.setIsLoading(false);
    }
  }, [authenticated, projectId, state]);
}

function useSaveFileAction(projectId: string, authenticated: boolean, readOnly: boolean, fetchFiles: () => Promise<void>, state: FilesystemState) {
  return useCallback(async (path: string, newContent: string) => {
    if (readOnly) return;
    if (isImagePath(path)) return;
    await writeProjectFile(projectId, path, newContent);
    state.setSavedContent(newContent);
    await fetchFiles();
  }, [authenticated, fetchFiles, projectId, readOnly, state]);
}

function useDeleteFileAction(projectId: string, authenticated: boolean, readOnly: boolean, selectedPath: string | null, fetchFiles: () => Promise<void>, state: FilesystemState) {
  return useCallback(async (path: string) => {
    if (readOnly) return;
    await deleteProjectFile(projectId, path);
    if (selectedPath === path) clearSelectedFileState(state.setSelectedPath, state.setContentState, state.setSavedContent);
    await fetchFiles();
  }, [authenticated, fetchFiles, projectId, readOnly, selectedPath, state]);
}

function useCreateFileAction(projectId: string, authenticated: boolean, readOnly: boolean, fetchFiles: () => Promise<void>, openFile: (path: string) => Promise<void>, state: FilesystemState) {
  return useCallback(async (path: string, initialContent = "") => {
    if (readOnly) return;
    const normalised = normalizePath(path);
    await writeProjectFile(projectId, normalised, initialContent);
    await fetchFiles();
    await openFile(normalised);
  }, [authenticated, fetchFiles, openFile, projectId, readOnly, state]);
}

function useMovePathsAction(
  projectId: string,
  authenticated: boolean,
  readOnly: boolean,
  selectedPath: string | null,
  fetchFiles: () => Promise<void>,
  state: FilesystemState,
) {
  return useCallback(async (sourcePaths: string[], destinationDir: string) => {
    if (readOnly || sourcePaths.length < 1) return [];
    if (!authenticated) return [];
    const result = await moveProjectPaths(projectId, sourcePaths, destinationDir);
    const moved = result.moved ?? [];
    const remapped = remapMovedPath(selectedPath, moved);
    if (remapped !== selectedPath) state.setSelectedPath(remapped);
    await fetchFiles();
    return moved;
  }, [authenticated, fetchFiles, projectId, readOnly, selectedPath, state]);
}

function useRenamePathAction(
  projectId: string,
  authenticated: boolean,
  readOnly: boolean,
  selectedPath: string | null,
  fetchFiles: () => Promise<void>,
  state: FilesystemState,
) {
  return useCallback(async (path: string, newName: string) => {
    if (readOnly) return null;
    if (!authenticated) return null;
    const result = await renameProjectPath(projectId, path, newName);
    const moved = result.moved;
    if (!moved) return null;
    const remapped = remapMovedPath(selectedPath, [moved]);
    if (remapped !== selectedPath) state.setSelectedPath(remapped);
    await fetchFiles();
    return moved;
  }, [authenticated, fetchFiles, projectId, readOnly, selectedPath, state]);
}

export function useFilesystem(projectId: string, options: UseFilesystemOptions): UseFilesystemReturn {
  const state = useFilesystemState();
  const isDirty = useMemo(() => state.content !== state.savedContent, [state.content, state.savedContent]);
  const fetchFiles = useFetchFilesAction(projectId, options.authenticated, state);
  const openFile = useOpenFileAction(projectId, options.authenticated, state);
  const saveFile = useSaveFileAction(projectId, options.authenticated, options.readOnly, fetchFiles, state);
  const deleteFile = useDeleteFileAction(projectId, options.authenticated, options.readOnly, state.selectedPath, fetchFiles, state);
  const createFile = useCreateFileAction(projectId, options.authenticated, options.readOnly, fetchFiles, openFile, state);
  const movePaths = useMovePathsAction(projectId, options.authenticated, options.readOnly, state.selectedPath, fetchFiles, state);
  const renamePath = useRenamePathAction(projectId, options.authenticated, options.readOnly, state.selectedPath, fetchFiles, state);
  const followFile = useFollowFileAction(projectId, options.authenticated, state);
  const setContent = useCallback((content: string) => state.setContentState(content), [state]);
  return { files: state.files, selectedPath: state.selectedPath, content: state.content, isDirty, isLoading: state.isLoading, fetchFiles, openFile, saveFile, deleteFile, createFile, movePaths, renamePath, followFile, setContent };
}
