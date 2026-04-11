import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";

import type { FileEntry } from "../../api/projects";
import type { FilesystemSyncEvent, PolicyCheckEvent, PolicyCheckIssue } from "../../contexts/FilesystemContext";

interface UseFilesystemPanelEffectsArgs {
  authenticated: boolean;
  projectId: string;
  workspaceTab: "code" | "costs" | "graph" | "state";
  setWorkspaceTab: (tab: "code" | "costs" | "graph" | "state") => void;
  files: FileEntry[];
  selectedPath: string | null;
  fetchFiles: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  followFile: (path: string, previewContent?: string) => Promise<void>;
  pushLog: (message: string) => void;
  setExpandedFolders: Dispatch<SetStateAction<Set<string>>>;
  setSelectedPaths: Dispatch<SetStateAction<Set<string>>>;
  registerRefreshCallback: (callback: (event?: FilesystemSyncEvent) => void) => () => void;
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

type SecurityProblem = Parameters<UseFilesystemPanelEffectsArgs["appendProblems"]>[0][number];
const FILESYSTEM_SYNC_INTERVAL_MS = 5000;

function buildFilePathKey(files: FileEntry[]) {
  return files.map((file) => file.path).join("|");
}

function collectFolderPaths(files: FileEntry[]) {
  const folders = new Set<string>();
  for (const file of files) {
    const parts = file.path.replace(/^\//, "").split("/");
    for (let index = 1; index < parts.length; index += 1) {
      folders.add(`/${parts.slice(0, index).join("/")}`);
    }
  }
  return folders;
}

function mergeExpandedFolders(setExpandedFolders: Dispatch<SetStateAction<Set<string>>>, folders: Set<string>) {
  setExpandedFolders((previous) => {
    const next = new Set(previous);
    for (const folder of folders) next.add(folder);
    return next;
  });
}

function useAutoExpandFolders(files: FileEntry[], setExpandedFolders: Dispatch<SetStateAction<Set<string>>>) {
  const previousFilesKeyRef = useRef("");
  const filesKey = useMemo(() => buildFilePathKey(files), [files]);
  useEffect(() => {
    if (filesKey === previousFilesKeyRef.current) return;
    previousFilesKeyRef.current = filesKey;
    mergeExpandedFolders(setExpandedFolders, collectFolderPaths(files));
  }, [files, filesKey, setExpandedFolders]);
}

function buildRefreshLog(event?: FilesystemSyncEvent) {
  if (!event?.path) return "Synced filesystem state";
  if (event.behavior === "follow" && event.source === "tool.start") return `Following agent edit: ${event.path}`;
  if (event.behavior === "follow") return `Opened agent edit: ${event.path}`;
  return `Synced change from agent: ${event.path}`;
}

function shouldFollowFile(event?: FilesystemSyncEvent) {
  return event?.behavior === "follow" && Boolean(event.path);
}

function shouldAutoSyncFilesystem(
  authenticated: boolean,
  workspaceTab: "code" | "costs" | "graph" | "state",
) {
  return authenticated && workspaceTab === "code";
}

function isDocumentHidden() {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

async function syncFilesystemChange(args: {
  event?: FilesystemSyncEvent;
  selectedPath: string | null;
  fetchFiles: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  followFile: (path: string, previewContent?: string) => Promise<void>;
  pushLog: (message: string) => void;
  setWorkspaceTab: (tab: "code" | "costs" | "graph" | "state") => void;
  setSelectedPaths: Dispatch<SetStateAction<Set<string>>>;
}) {
  if (args.event?.source === "tool.start") {
    args.pushLog(buildRefreshLog(args.event));
    if (!shouldFollowFile(args.event)) return;
    args.setWorkspaceTab("code");
    args.setSelectedPaths(new Set([args.event.path!]));
    await args.followFile(args.event.path!, args.event.previewContent);
    return;
  }
  await args.fetchFiles();
  args.pushLog(buildRefreshLog(args.event));
  const followFile = shouldFollowFile(args.event);
  if (!followFile && (!args.event?.path || args.event.path !== args.selectedPath)) return;
  const path = args.event?.path ?? args.selectedPath;
  if (!path) return;
  if (followFile) {
    args.setWorkspaceTab("code");
    args.setSelectedPaths(new Set([path]));
    await args.followFile(path);
    return;
  }
  await args.openFile(path);
}

function useRefreshRegistration(args: {
  selectedPath: string | null;
  fetchFiles: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  followFile: (path: string, previewContent?: string) => Promise<void>;
  pushLog: (message: string) => void;
  setWorkspaceTab: (tab: "code" | "costs" | "graph" | "state") => void;
  setSelectedPaths: Dispatch<SetStateAction<Set<string>>>;
  registerRefreshCallback: (callback: (event?: FilesystemSyncEvent) => void) => () => void;
}) {
  const onRefresh = useCallback((event?: FilesystemSyncEvent) => {
    void syncFilesystemChange({
      event,
      selectedPath: args.selectedPath,
      fetchFiles: args.fetchFiles,
      openFile: args.openFile,
      followFile: args.followFile,
      pushLog: args.pushLog,
      setWorkspaceTab: args.setWorkspaceTab,
      setSelectedPaths: args.setSelectedPaths,
    });
  }, [args.fetchFiles, args.followFile, args.openFile, args.pushLog, args.selectedPath, args.setSelectedPaths, args.setWorkspaceTab]);
  useEffect(() => args.registerRefreshCallback(onRefresh), [args.registerRefreshCallback, onRefresh]);
}

function useFilesystemAutoSync(args: {
  authenticated: boolean;
  workspaceTab: "code" | "costs" | "graph" | "state";
  fetchFiles: () => Promise<void>;
}) {
  const { authenticated, workspaceTab, fetchFiles } = args;
  const mountedRef = useRef(false);
  const syncingRef = useRef(false);
  const sync = useCallback(async () => {
    if (!shouldAutoSyncFilesystem(authenticated, workspaceTab) || isDocumentHidden() || syncingRef.current) return;
    syncingRef.current = true;
    try {
      await fetchFiles();
    } finally {
      syncingRef.current = false;
    }
  }, [authenticated, fetchFiles, workspaceTab]);
  useEffect(() => {
    if (!shouldAutoSyncFilesystem(authenticated, workspaceTab)) return;
    if (mountedRef.current) void sync();
    else mountedRef.current = true;
    const handleFocus = () => void sync();
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);
    const timer = window.setInterval(handleFocus, FILESYSTEM_SYNC_INTERVAL_MS);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
      window.clearInterval(timer);
    };
  }, [authenticated, workspaceTab, sync]);
}

function mapPolicyIssues(issues: PolicyCheckIssue[]): SecurityProblem[] {
  return issues.map((issue) => ({
    mode: "security",
    message: issue.message,
    severity: issue.severity,
    path: issue.path,
    line: issue.line,
    ruleId: issue.ruleId,
    source: issue.source,
  }));
}

function logPolicyScanStart(event: Extract<PolicyCheckEvent, { type: "policy.check.start" }>, pushLog: (message: string) => void) {
  const changed = event.changedPaths.slice(0, 4).join(", ");
  if (event.changedPaths.length < 1) {
    pushLog("Starting security scan");
    return;
  }
  pushLog(`Starting security scan on ${event.changedPaths.length} changed file(s): ${changed}`);
}

function handlePolicyScanResult(
  event: Extract<PolicyCheckEvent, { type: "policy.check.result" }>,
  pushLog: (message: string) => void,
  appendProblems: UseFilesystemPanelEffectsArgs["appendProblems"],
) {
  const issueCount = event.summary.total;
  if (issueCount > 0) {
    pushLog(`Security scan found ${issueCount} issue(s).`);
    appendProblems(mapPolicyIssues(event.issues), { switchToProblems: true });
  } else {
    pushLog("Security scan finished with no issues.");
  }
  if (event.scanError?.message) pushLog(`Security scan warning: ${event.scanError.message}`);
}

function handlePolicyEvent(
  event: PolicyCheckEvent,
  pushLog: (message: string) => void,
  appendProblems: UseFilesystemPanelEffectsArgs["appendProblems"],
) {
  if (event.type === "policy.check.start") {
    logPolicyScanStart(event, pushLog);
    return;
  }
  handlePolicyScanResult(event, pushLog, appendProblems);
}

function usePolicyRegistration(args: {
  pushLog: (message: string) => void;
  appendProblems: UseFilesystemPanelEffectsArgs["appendProblems"];
  registerPolicyCheckCallback: (callback: (event: PolicyCheckEvent) => void) => () => void;
}) {
  const onPolicyCheck = useCallback((event: PolicyCheckEvent) => {
    handlePolicyEvent(event, args.pushLog, args.appendProblems);
  }, [args.appendProblems, args.pushLog]);
  useEffect(() => args.registerPolicyCheckCallback(onPolicyCheck), [args.registerPolicyCheckCallback, onPolicyCheck]);
}

function useInitialFilesystemLoad(fetchFiles: () => Promise<void>, pushLog: (message: string) => void) {
  useEffect(() => {
    void fetchFiles().then(() => pushLog("Loaded project files"));
  }, [fetchFiles, pushLog]);
}

function useProjectResetEffects(
  projectId: string,
  resetWorkflow: () => void,
  setWorkspaceTab: (tab: "code" | "costs" | "graph" | "state") => void,
) {
  useEffect(() => {
    resetWorkflow();
  }, [projectId, resetWorkflow]);
  useEffect(() => {
    setWorkspaceTab("code");
  }, [projectId, setWorkspaceTab]);
}

function useLazyWorkspaceLoaders(args: {
  authenticated: boolean;
  workspaceTab: "code" | "costs" | "graph" | "state";
  loadCosts: (opts: { scope: string }) => Promise<void>;
  costScope: string;
  loadGraph: (opts: { scope: string }) => Promise<void>;
  graphScope: string;
}) {
  useEffect(() => {
    if (!args.authenticated || args.workspaceTab !== "costs") return;
    void args.loadCosts({ scope: args.costScope });
  }, [args.authenticated, args.costScope, args.loadCosts, args.workspaceTab]);
  useEffect(() => {
    if (!args.authenticated || args.workspaceTab !== "graph") return;
    void args.loadGraph({ scope: args.graphScope });
  }, [args.authenticated, args.graphScope, args.loadGraph, args.workspaceTab]);
}

export function useFilesystemPanelEffects(args: UseFilesystemPanelEffectsArgs) {
  useAutoExpandFolders(args.files, args.setExpandedFolders);
  useRefreshRegistration({
    selectedPath: args.selectedPath,
    setWorkspaceTab: args.setWorkspaceTab,
    fetchFiles: args.fetchFiles,
    openFile: args.openFile,
    followFile: args.followFile,
    pushLog: args.pushLog,
    setSelectedPaths: args.setSelectedPaths,
    registerRefreshCallback: args.registerRefreshCallback,
  });
  usePolicyRegistration({
    pushLog: args.pushLog,
    appendProblems: args.appendProblems,
    registerPolicyCheckCallback: args.registerPolicyCheckCallback,
  });
  useFilesystemAutoSync({
    authenticated: args.authenticated,
    workspaceTab: args.workspaceTab,
    fetchFiles: args.fetchFiles,
  });
  useInitialFilesystemLoad(args.fetchFiles, args.pushLog);
  useProjectResetEffects(args.projectId, args.resetWorkflow, args.setWorkspaceTab);
  useLazyWorkspaceLoaders({
    authenticated: args.authenticated,
    workspaceTab: args.workspaceTab,
    loadCosts: args.loadCosts,
    costScope: args.costScope,
    loadGraph: args.loadGraph,
    graphScope: args.graphScope,
  });
}
