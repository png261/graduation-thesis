import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";

import type { FileEntry } from "../../api/projects";
import type { PolicyCheckEvent } from "../../contexts/FilesystemContext";

interface UseFilesystemPanelEffectsArgs {
  authenticated: boolean;
  projectId: string;
  workspaceTab: "code" | "costs" | "graph";
  setWorkspaceTab: (tab: "code" | "costs" | "graph") => void;
  files: FileEntry[];
  selectedPath: string | null;
  fetchFiles: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  pushLog: (message: string) => void;
  setExpandedFolders: Dispatch<SetStateAction<Set<string>>>;
  registerRefreshCallback: (callback: (changedPath?: string) => void) => () => void;
  registerPolicyCheckCallback: (callback: (event: PolicyCheckEvent) => void) => () => void;
  appendProblems: (
    issues: Array<{
      mode: "security";
      message: string;
      severity: string;
      path?: string;
      line?: number;
      ruleId?: string;
      source: "secret" | "misconfig";
    }>,
    options: { switchToProblems: boolean },
  ) => void;
  resetWorkflow: () => void;
  loadCosts: (opts: { scope: string }) => Promise<void>;
  costScope: string;
  loadGraph: (opts: { scope: string }) => Promise<void>;
  graphScope: string;
}

export function useFilesystemPanelEffects({
  authenticated,
  projectId,
  workspaceTab,
  setWorkspaceTab,
  files,
  selectedPath,
  fetchFiles,
  openFile,
  pushLog,
  setExpandedFolders,
  registerRefreshCallback,
  registerPolicyCheckCallback,
  appendProblems,
  resetWorkflow,
  loadCosts,
  costScope,
  loadGraph,
  graphScope,
}: UseFilesystemPanelEffectsArgs) {
  const prevFilesRef = useRef("");

  useEffect(() => {
    const key = files.map((file) => file.path).join("|");
    if (key === prevFilesRef.current) return;
    prevFilesRef.current = key;

    const folders = new Set<string>();
    for (const file of files) {
      const parts = file.path.replace(/^\//, "").split("/");
      for (let i = 1; i < parts.length; i += 1) {
        folders.add(`/${parts.slice(0, i).join("/")}`);
      }
    }

    setExpandedFolders((prev) => {
      const next = new Set(prev);
      for (const folder of folders) next.add(folder);
      return next;
    });
  }, [files, setExpandedFolders]);

  useEffect(() => {
    const unregister = registerRefreshCallback((changedPath?: string) => {
      void (async () => {
        await fetchFiles();
        pushLog(changedPath ? `Synced change from agent: ${changedPath}` : "Synced filesystem state");
        if (changedPath && selectedPath && changedPath === selectedPath) {
          await openFile(selectedPath);
        }
      })();
    });
    return unregister;
  }, [registerRefreshCallback, fetchFiles, selectedPath, openFile, pushLog]);

  useEffect(() => {
    const unregister = registerPolicyCheckCallback((event) => {
      if (event.type === "policy.check.start") {
        const changed = event.changedPaths.slice(0, 4).join(", ");
        pushLog(
          event.changedPaths.length > 0
            ? `Starting security scan on ${event.changedPaths.length} changed file(s): ${changed}`
            : "Starting security scan",
        );
        return;
      }

      const issueCount = event.summary?.total ?? event.issues?.length ?? 0;
      if (issueCount > 0) {
        pushLog(`Security scan found ${issueCount} issue(s).`);
        appendProblems(
          (event.issues ?? []).map((issue) => ({
            mode: "security",
            message: issue.message,
            severity: issue.severity,
            path: issue.path,
            line: issue.line,
            ruleId: issue.ruleId,
            source: issue.source,
          })),
          { switchToProblems: true },
        );
      } else {
        pushLog("Security scan finished with no issues.");
      }

      if (event.scanError?.message) {
        pushLog(`Security scan warning: ${event.scanError.message}`);
      }
    });
    return unregister;
  }, [appendProblems, pushLog, registerPolicyCheckCallback]);

  useEffect(() => {
    fetchFiles().then(() => pushLog("Loaded project files"));
  }, [fetchFiles, pushLog]);

  useEffect(() => {
    resetWorkflow();
  }, [projectId, resetWorkflow]);

  useEffect(() => {
    setWorkspaceTab("code");
  }, [projectId, setWorkspaceTab]);

  useEffect(() => {
    if (!authenticated) setWorkspaceTab("code");
  }, [authenticated, setWorkspaceTab]);

  useEffect(() => {
    if (!authenticated) return;
    if (workspaceTab !== "costs") return;
    void loadCosts({ scope: costScope });
  }, [authenticated, costScope, loadCosts, workspaceTab]);

  useEffect(() => {
    if (!authenticated) return;
    if (workspaceTab !== "graph") return;
    void loadGraph({ scope: graphScope });
  }, [authenticated, graphScope, loadGraph, workspaceTab]);
}
