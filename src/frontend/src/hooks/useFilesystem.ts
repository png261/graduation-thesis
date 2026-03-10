import { useState, useCallback, useMemo } from "react";
import {
  deleteProjectFile,
  listProjectFiles,
  readProjectFile,
  writeProjectFile,
  type FileEntry,
} from "../api/projects";

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
  setContent: (c: string) => void;
}

interface UseFilesystemOptions {
  authenticated: boolean;
  readOnly: boolean;
}

function makeFileEntries(fileMap: Record<string, string>): FileEntry[] {
  const now = new Date().toISOString();
  return Object.keys(fileMap)
    .sort()
    .map((path) => ({
      path,
      size: fileMap[path].length,
      modifiedAt: now,
      createdAt: now,
    }));
}

export function getGuestFilesSnapshot(projectId: string): Array<{ path: string; content: string }> {
  const files = guestFileStore.get(projectId) ?? {};
  return Object.entries(files).map(([path, content]) => ({ path, content }));
}

export function useFilesystem(projectId: string, options: UseFilesystemOptions): UseFilesystemReturn {
  const { authenticated, readOnly } = options;
  const [guestFiles, setGuestFiles] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContentState] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const isDirty = useMemo(() => content !== savedContent, [content, savedContent]);

  const fetchFiles = useCallback(async () => {
    if (!projectId) return;

    if (!authenticated) {
      const filesForProject = guestFileStore.get(projectId) ?? guestFiles;
      if (!guestFileStore.has(projectId)) {
        guestFileStore.set(projectId, filesForProject);
      }
      setFiles(makeFileEntries(filesForProject));
      const firstPath = Object.keys(filesForProject).sort()[0];
      if (!selectedPath && firstPath) {
        const firstContent = filesForProject[firstPath];
        setSelectedPath(firstPath);
        setContentState(firstContent);
        setSavedContent(firstContent);
      }
      return;
    }

    try {
      const data = await listProjectFiles(projectId);
      setFiles(data);
    } catch {
      // non-fatal
    }
  }, [projectId, authenticated, guestFiles, selectedPath]);

  const openFile = useCallback(
    async (path: string) => {
      setIsLoading(true);
      try {
        if (!authenticated) {
          const value = guestFiles[path] ?? "";
          setSelectedPath(path);
          setContentState(value);
          setSavedContent(value);
          return;
        }

        const data = await readProjectFile(projectId, path);
        setSelectedPath(path);
        setContentState(data);
        setSavedContent(data);
      } catch {
        // non-fatal
      } finally {
        setIsLoading(false);
      }
    },
    [projectId, authenticated, guestFiles],
  );

  const saveFile = useCallback(
    async (path: string, newContent: string) => {
      if (readOnly) return;

      if (!authenticated) {
        setGuestFiles((prev) => {
          const next = { ...prev, [path]: newContent };
          guestFileStore.set(projectId, next);
          return next;
        });
        setSavedContent(newContent);
        return;
      }

      await writeProjectFile(projectId, path, newContent);
      setSavedContent(newContent);
      await fetchFiles();
    },
    [projectId, authenticated, readOnly, fetchFiles],
  );

  const deleteFile = useCallback(
    async (path: string) => {
      if (readOnly) return;

      if (!authenticated) {
        setGuestFiles((prev) => {
          const next = { ...prev };
          delete next[path];
          guestFileStore.set(projectId, next);
          return next;
        });
        if (selectedPath === path) {
          setSelectedPath(null);
          setContentState("");
          setSavedContent("");
        }
        return;
      }

      await deleteProjectFile(projectId, path);
      if (selectedPath === path) {
        setSelectedPath(null);
        setContentState("");
        setSavedContent("");
      }
      await fetchFiles();
    },
    [projectId, authenticated, readOnly, selectedPath, fetchFiles],
  );

  const createFile = useCallback(
    async (path: string, initialContent = "") => {
      if (readOnly) return;

      const normalised = path.startsWith("/") ? path : `/${path}`;

      if (!authenticated) {
        setGuestFiles((prev) => {
          const next = { ...prev, [normalised]: initialContent };
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
    },
    [projectId, authenticated, readOnly, fetchFiles, openFile],
  );

  const setContent = useCallback((c: string) => {
    setContentState(c);
  }, []);

  return {
    files,
    selectedPath,
    content,
    isDirty,
    isLoading,
    fetchFiles,
    openFile,
    saveFile,
    deleteFile,
    createFile,
    setContent,
  };
}
