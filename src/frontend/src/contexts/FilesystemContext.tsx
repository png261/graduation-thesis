import { createContext, useContext, useRef } from "react";
import type { MutableRefObject, PropsWithChildren } from "react";

export interface FilesystemSyncEvent {
  path?: string;
  behavior?: "refresh" | "follow";
  previewContent?: string;
  source?: "tool.start" | "tool.result";
}

type RefreshCallback = (event?: FilesystemSyncEvent) => void;
type PolicyCheckCallback = (event: PolicyCheckEvent) => void;

export interface PolicyCheckIssue {
  source: "misconfig" | "secret";
  severity: string;
  message: string;
  title?: string;
  ruleId?: string;
  path?: string;
  line?: number;
  endLine?: number;
  referenceUrl?: string;
}

export interface PolicyCheckSummary {
  total: number;
  bySeverity: Record<string, number>;
}

export interface PolicyCheckScanError {
  code: string;
  message: string;
}

export type PolicyCheckEvent =
  | {
      type: "policy.check.start";
      changedPaths: string[];
    }
  | {
      type: "policy.check.result";
      changedPaths: string[];
      issues: PolicyCheckIssue[];
      summary: PolicyCheckSummary;
      scanError?: PolicyCheckScanError | null;
    };

interface FilesystemContextValue {
  /** Called by LocalRuntimeProvider when agent file activity should reach the filesystem UI. */
  notifyFileChanged: (event?: FilesystemSyncEvent) => void;
  /** FilesystemPanel registers itself here on mount to receive change signals. */
  registerRefreshCallback: (fn: RefreshCallback) => () => void;
  notifyPolicyCheck: (event: PolicyCheckEvent) => void;
  registerPolicyCheckCallback: (fn: PolicyCheckCallback) => () => void;
}

const FilesystemContext = createContext<FilesystemContextValue | null>(null);

function createCallbackNotifier<T>(callbacksRef: MutableRefObject<Set<(payload: T) => void>>) {
  return (payload: T) => {
    for (const callback of callbacksRef.current) callback(payload);
  };
}

function createCallbackRegistrar<T>(callbacksRef: MutableRefObject<Set<(payload: T) => void>>) {
  return (callback: (payload: T) => void) => {
    callbacksRef.current.add(callback);
    return () => callbacksRef.current.delete(callback);
  };
}

function useCallbackRegistry<T>() {
  const callbacksRef = useRef<Set<(payload: T) => void>>(new Set());
  return {
    notify: createCallbackNotifier(callbacksRef),
    register: createCallbackRegistrar(callbacksRef),
  };
}

export function FilesystemContextProvider({ children }: PropsWithChildren) {
  const refreshRegistry = useCallbackRegistry<FilesystemSyncEvent | undefined>();
  const policyRegistry = useCallbackRegistry<PolicyCheckEvent>();
  const value: FilesystemContextValue = {
    notifyFileChanged: refreshRegistry.notify as RefreshCallback,
    registerRefreshCallback: refreshRegistry.register as (fn: RefreshCallback) => () => void,
    notifyPolicyCheck: policyRegistry.notify as PolicyCheckCallback,
    registerPolicyCheckCallback: policyRegistry.register as (fn: PolicyCheckCallback) => () => void,
  };
  return <FilesystemContext.Provider value={value}>{children}</FilesystemContext.Provider>;
}

export function useFilesystemContext(): FilesystemContextValue {
  const ctx = useContext(FilesystemContext);
  if (!ctx) throw new Error("useFilesystemContext must be used inside FilesystemContextProvider");
  return ctx;
}
