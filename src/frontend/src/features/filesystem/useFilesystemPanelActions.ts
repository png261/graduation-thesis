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

function normalizePath(name: string): string {
  return name.startsWith("/") ? name : `/${name}`;
}

function useDeleteAction(authenticated: boolean, files: FileEntry[], deleteFile: (path: string) => Promise<void>, pushLog: (message: string) => void) {
  return useCallback(async (path: string, isFolder: boolean) => {
    if (!authenticated) return;
    if (!isFolder) {
      await deleteFile(path);
      pushLog(`Deleted file ${path}`);
      return;
    }
    const toDelete = files.filter((file) => file.path.startsWith(`${path}/`) || file.path === path);
    await Promise.all(toDelete.map((file) => deleteFile(file.path)));
    pushLog(`Deleted folder ${path}`);
  }, [authenticated, deleteFile, files, pushLog]);
}

function useCreateItemActions(
  authenticated: boolean,
  createFile: (path: string, content?: string) => Promise<void>,
  setNewItemMode: (mode: "file" | "folder" | null) => void,
  pushLog: (message: string) => void,
) {
  const handleNewFile = useCallback(async (name: string) => {
    if (!authenticated) return;
    setNewItemMode(null);
    const path = normalizePath(name);
    await createFile(path, "");
    pushLog(`Created file ${path}`);
  }, [authenticated, createFile, pushLog, setNewItemMode]);
  const handleNewFolder = useCallback(async (name: string) => {
    if (!authenticated) return;
    setNewItemMode(null);
    const path = normalizePath(name);
    await createFile(`${path}/.gitkeep`, "");
    pushLog(`Created folder ${path}`);
  }, [authenticated, createFile, pushLog, setNewItemMode]);
  return { handleNewFile, handleNewFolder };
}

function useSaveAction(
  authenticated: boolean,
  selectedPath: string | null,
  content: string,
  saveFile: (path: string, content: string) => Promise<void>,
  pushLog: (message: string) => void,
) {
  return useCallback(async () => {
    if (!authenticated || !selectedPath) return;
    await saveFile(selectedPath, content);
    pushLog(`Saved ${selectedPath}`);
  }, [authenticated, content, pushLog, saveFile, selectedPath]);
}

function useSaveShortcut(handleSave: () => Promise<void>) {
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
}

function useFileIoActions(
  openFile: (path: string) => Promise<void>,
  fetchFiles: () => Promise<void>,
  pushLog: (message: string) => void,
) {
  const handleOpenFile = useCallback(async (path: string) => {
    await openFile(path);
    pushLog(`Opened ${path}`);
  }, [openFile, pushLog]);
  const handleRefresh = useCallback(async () => {
    await fetchFiles();
    pushLog("Refreshed file tree");
  }, [fetchFiles, pushLog]);
  return { handleOpenFile, handleRefresh };
}

function useWorkflowAction(clearExportError: () => void, runWorkflow: (mode: "plan" | "apply") => Promise<void>) {
  return useCallback(async (mode: "plan" | "apply") => {
    clearExportError();
    await runWorkflow(mode);
  }, [clearExportError, runWorkflow]);
}

export function useFilesystemPanelActions(args: UseFilesystemPanelActionsArgs) {
  const handleDelete = useDeleteAction(args.authenticated, args.files, args.deleteFile, args.pushLog);
  const { handleNewFile, handleNewFolder } = useCreateItemActions(args.authenticated, args.createFile, args.setNewItemMode, args.pushLog);
  const handleSave = useSaveAction(args.authenticated, args.selectedPath, args.content, args.saveFile, args.pushLog);
  const { handleOpenFile, handleRefresh } = useFileIoActions(args.openFile, args.fetchFiles, args.pushLog);
  const handleRunWorkflow = useWorkflowAction(args.clearExportError, args.runWorkflow);
  useSaveShortcut(handleSave);
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
