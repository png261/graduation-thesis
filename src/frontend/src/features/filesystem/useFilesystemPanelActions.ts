import { useCallback, useEffect } from "react";

import type { FileEntry } from "../../api/projects";

interface UseFilesystemPanelActionsArgs {
  authenticated: boolean;
  files: FileEntry[];
  selectedPath: string | null;
  content: string;
  deleteFile: (path: string) => Promise<void>;
  createFile: (path: string, content?: string) => Promise<void>;
  saveFile: (path: string, content: string) => Promise<void>;
  openFile: (path: string) => Promise<void>;
  fetchFiles: () => Promise<void>;
  setNewItemMode: (mode: "file" | "folder" | null) => void;
  clearExportError: () => void;
  runWorkflow: (mode: "plan" | "apply") => Promise<void>;
  pushLog: (message: string) => void;
}

export function useFilesystemPanelActions({
  authenticated,
  files,
  selectedPath,
  content,
  deleteFile,
  createFile,
  saveFile,
  openFile,
  fetchFiles,
  setNewItemMode,
  clearExportError,
  runWorkflow,
  pushLog,
}: UseFilesystemPanelActionsArgs) {
  const handleDelete = useCallback(
    async (path: string, isFolder: boolean) => {
      if (!authenticated) return;
      if (isFolder) {
        const toDelete = files.filter((file) => file.path.startsWith(`${path}/`) || file.path === path);
        await Promise.all(toDelete.map((file) => deleteFile(file.path)));
        pushLog(`Deleted folder ${path}`);
      } else {
        await deleteFile(path);
        pushLog(`Deleted file ${path}`);
      }
    },
    [authenticated, files, deleteFile, pushLog],
  );

  const handleNewFile = useCallback(
    async (name: string) => {
      if (!authenticated) return;
      setNewItemMode(null);
      const path = name.startsWith("/") ? name : `/${name}`;
      await createFile(path, "");
      pushLog(`Created file ${path}`);
    },
    [authenticated, createFile, pushLog, setNewItemMode],
  );

  const handleNewFolder = useCallback(
    async (name: string) => {
      if (!authenticated) return;
      setNewItemMode(null);
      const path = name.startsWith("/") ? name : `/${name}`;
      await createFile(`${path}/.gitkeep`, "");
      pushLog(`Created folder ${path}`);
    },
    [authenticated, createFile, pushLog, setNewItemMode],
  );

  const handleSave = useCallback(async () => {
    if (!authenticated) return;
    if (!selectedPath) return;
    await saveFile(selectedPath, content);
    pushLog(`Saved ${selectedPath}`);
  }, [authenticated, selectedPath, content, saveFile, pushLog]);

  const handleOpenFile = useCallback(
    async (path: string) => {
      await openFile(path);
      pushLog(`Opened ${path}`);
    },
    [openFile, pushLog],
  );

  const handleRefresh = useCallback(async () => {
    await fetchFiles();
    pushLog("Refreshed file tree");
  }, [fetchFiles, pushLog]);

  const handleRunWorkflow = useCallback(
    async (mode: "plan" | "apply") => {
      clearExportError();
      await runWorkflow(mode);
    },
    [clearExportError, runWorkflow],
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        void handleSave();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

  return {
    handleDelete,
    handleNewFile,
    handleNewFolder,
    handleSave,
    handleOpenFile,
    handleRefresh,
    handleRunWorkflow,
  };
}
