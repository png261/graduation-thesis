import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import { deleteProjectFile, listProjectFiles, readProjectFile, writeProjectFile, type FileEntry } from "../api/projects";

export type { FileEntry };

const guestFileStore = new Map<string, Record<string, string>>();

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
  setContent: (content: string) => void;
}

interface UseFilesystemOptions {
  authenticated: boolean;
  readOnly: boolean;
}

function normalizePath(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
}

function makeFileEntries(fileMap: Record<string, string>): FileEntry[] {
  const now = new Date().toISOString();
  return Object.keys(fileMap).sort().map((path) => ({ path, size: fileMap[path].length, modifiedAt: now, createdAt: now }));
}

function getGuestFilesSnapshotForProject(projectId: string, guestFiles: Record<string, string>) {
  const filesForProject = guestFileStore.get(projectId) ?? guestFiles;
  if (!guestFileStore.has(projectId)) guestFileStore.set(projectId, filesForProject);
  return filesForProject;
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
  const [guestFiles, setGuestFiles] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContentState] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  return { guestFiles, setGuestFiles, files, setFiles, selectedPath, setSelectedPath, content, setContentState, savedContent, setSavedContent, isLoading, setIsLoading };
}

type FilesystemState = ReturnType<typeof useFilesystemState>;

function useFetchFilesAction(projectId: string, authenticated: boolean, state: FilesystemState) {
  return useCallback(async () => {
    if (!projectId) return;
    if (!authenticated) {
      const filesForProject = getGuestFilesSnapshotForProject(projectId, state.guestFiles);
      state.setFiles(makeFileEntries(filesForProject));
      const firstPath = Object.keys(filesForProject).sort()[0];
      if (!state.selectedPath && firstPath) setSelectedFileState(firstPath, filesForProject[firstPath], state.setSelectedPath, state.setContentState, state.setSavedContent);
      return;
    }
    try {
      state.setFiles(await listProjectFiles(projectId));
    } catch {
      // non-fatal
    }
  }, [authenticated, projectId, state.guestFiles, state.selectedPath, state.setContentState, state.setFiles, state.setSavedContent, state.setSelectedPath]);
}

function useOpenFileAction(projectId: string, authenticated: boolean, guestFiles: Record<string, string>, state: FilesystemState) {
  return useCallback(async (path: string) => {
    state.setIsLoading(true);
    try {
      if (!authenticated) {
        setSelectedFileState(path, guestFiles[path] ?? "", state.setSelectedPath, state.setContentState, state.setSavedContent);
        return;
      }
      const data = await readProjectFile(projectId, path);
      setSelectedFileState(path, data, state.setSelectedPath, state.setContentState, state.setSavedContent);
    } catch {
      // non-fatal
    } finally {
      state.setIsLoading(false);
    }
  }, [authenticated, guestFiles, projectId, state]);
}

function useSaveFileAction(projectId: string, authenticated: boolean, readOnly: boolean, fetchFiles: () => Promise<void>, state: FilesystemState) {
  return useCallback(async (path: string, newContent: string) => {
    if (readOnly) return;
    if (!authenticated) {
      state.setGuestFiles((previous) => {
        const next = { ...previous, [path]: newContent };
        guestFileStore.set(projectId, next);
        return next;
      });
      state.setSavedContent(newContent);
      return;
    }
    await writeProjectFile(projectId, path, newContent);
    state.setSavedContent(newContent);
    await fetchFiles();
  }, [authenticated, fetchFiles, projectId, readOnly, state]);
}

function useDeleteFileAction(projectId: string, authenticated: boolean, readOnly: boolean, selectedPath: string | null, fetchFiles: () => Promise<void>, state: FilesystemState) {
  return useCallback(async (path: string) => {
    if (readOnly) return;
    if (!authenticated) {
      state.setGuestFiles((previous) => {
        const next = { ...previous };
        delete next[path];
        guestFileStore.set(projectId, next);
        return next;
      });
      if (selectedPath === path) clearSelectedFileState(state.setSelectedPath, state.setContentState, state.setSavedContent);
      return;
    }
    await deleteProjectFile(projectId, path);
    if (selectedPath === path) clearSelectedFileState(state.setSelectedPath, state.setContentState, state.setSavedContent);
    await fetchFiles();
  }, [authenticated, fetchFiles, projectId, readOnly, selectedPath, state]);
}

function useCreateFileAction(projectId: string, authenticated: boolean, readOnly: boolean, fetchFiles: () => Promise<void>, openFile: (path: string) => Promise<void>, state: FilesystemState) {
  return useCallback(async (path: string, initialContent = "") => {
    if (readOnly) return;
    const normalised = normalizePath(path);
    if (!authenticated) {
      state.setGuestFiles((previous) => {
        const next = { ...previous, [normalised]: initialContent };
        guestFileStore.set(projectId, next);
        return next;
      });
      await fetchFiles();
      await openFile(normalised);
      return;
    }
    await writeProjectFile(projectId, normalised, initialContent);
    await fetchFiles();
    await openFile(normalised);
  }, [authenticated, fetchFiles, openFile, projectId, readOnly, state]);
}

export function getGuestFilesSnapshot(projectId: string): Array<{ path: string; content: string }> {
  const files = guestFileStore.get(projectId) ?? {};
  return Object.entries(files).map(([path, content]) => ({ path, content }));
}

export function useFilesystem(projectId: string, options: UseFilesystemOptions): UseFilesystemReturn {
  const state = useFilesystemState();
  const isDirty = useMemo(() => state.content !== state.savedContent, [state.content, state.savedContent]);
  const fetchFiles = useFetchFilesAction(projectId, options.authenticated, state);
  const openFile = useOpenFileAction(projectId, options.authenticated, state.guestFiles, state);
  const saveFile = useSaveFileAction(projectId, options.authenticated, options.readOnly, fetchFiles, state);
  const deleteFile = useDeleteFileAction(projectId, options.authenticated, options.readOnly, state.selectedPath, fetchFiles, state);
  const createFile = useCreateFileAction(projectId, options.authenticated, options.readOnly, fetchFiles, openFile, state);
  const setContent = useCallback((content: string) => state.setContentState(content), [state]);
  return { files: state.files, selectedPath: state.selectedPath, content: state.content, isDirty, isLoading: state.isLoading, fetchFiles, openFile, saveFile, deleteFile, createFile, setContent };
}
