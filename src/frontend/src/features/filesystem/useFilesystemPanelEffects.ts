import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";

import type { FileEntry } from "../../api/projects";
import type { PolicyCheckEvent, PolicyCheckIssue } from "../../contexts/FilesystemContext";

interface UseFilesystemPanelEffectsArgs {
  authenticated: boolean;
  projectId: string;
  workspaceTab: "code" | "costs" | "graph" | "jobs" | "state";
  setWorkspaceTab: (tab: "code" | "costs" | "graph" | "jobs" | "state") => void;
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

type SecurityProblem = Parameters<UseFilesystemPanelEffectsArgs["appendProblems"]>[0][number];

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

function buildRefreshLog(changedPath?: string) {
  if (!changedPath) return "Synced filesystem state";
  return `Synced change from agent: ${changedPath}`;
}

async function syncFilesystemChange(args: {
  changedPath?: string;
  selectedPath: string | null;
  fetchFiles: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  pushLog: (message: string) => void;
}) {
  await args.fetchFiles();
  args.pushLog(buildRefreshLog(args.changedPath));
  if (!args.changedPath || args.changedPath !== args.selectedPath) return;
  await args.openFile(args.selectedPath);
}

function useRefreshRegistration(args: {
  selectedPath: string | null;
  fetchFiles: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  pushLog: (message: string) => void;
  registerRefreshCallback: (callback: (changedPath?: string) => void) => () => void;
}) {
  const onRefresh = useCallback((changedPath?: string) => {
    void syncFilesystemChange({ changedPath, selectedPath: args.selectedPath, fetchFiles: args.fetchFiles, openFile: args.openFile, pushLog: args.pushLog });
  }, [args.fetchFiles, args.openFile, args.pushLog, args.selectedPath]);
  useEffect(() => args.registerRefreshCallback(onRefresh), [args.registerRefreshCallback, onRefresh]);
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
  setWorkspaceTab: (tab: "code" | "costs" | "graph" | "jobs" | "state") => void,
) {
  useEffect(() => {
    resetWorkflow();
  }, [projectId, resetWorkflow]);
  useEffect(() => {
    setWorkspaceTab("code");
  }, [projectId, setWorkspaceTab]);
}

function useGuestWorkspaceGuard(authenticated: boolean, setWorkspaceTab: (tab: "code" | "costs" | "graph" | "jobs" | "state") => void) {
  useEffect(() => {
    if (!authenticated) setWorkspaceTab("code");
  }, [authenticated, setWorkspaceTab]);
}

function useLazyWorkspaceLoaders(args: {
  authenticated: boolean;
  workspaceTab: "code" | "costs" | "graph" | "jobs" | "state";
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
    fetchFiles: args.fetchFiles,
    openFile: args.openFile,
    pushLog: args.pushLog,
    registerRefreshCallback: args.registerRefreshCallback,
  });
  usePolicyRegistration({
    pushLog: args.pushLog,
    appendProblems: args.appendProblems,
    registerPolicyCheckCallback: args.registerPolicyCheckCallback,
  });
  useInitialFilesystemLoad(args.fetchFiles, args.pushLog);
  useProjectResetEffects(args.projectId, args.resetWorkflow, args.setWorkspaceTab);
  useGuestWorkspaceGuard(args.authenticated, args.setWorkspaceTab);
  useLazyWorkspaceLoaders({
    authenticated: args.authenticated,
    workspaceTab: args.workspaceTab,
    loadCosts: args.loadCosts,
    costScope: args.costScope,
    loadGraph: args.loadGraph,
    graphScope: args.graphScope,
  });
}
