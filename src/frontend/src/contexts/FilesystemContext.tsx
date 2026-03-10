import { createContext, useContext, useRef } from "react";
import type { PropsWithChildren } from "react";

type RefreshCallback = (path?: string) => void;
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
  /** Called by LocalRuntimeProvider when write_file / edit_file tool completes. */
  notifyFileChanged: (path?: string) => void;
  /** FilesystemPanel registers itself here on mount to receive change signals. */
  registerRefreshCallback: (fn: RefreshCallback) => () => void;
  notifyPolicyCheck: (event: PolicyCheckEvent) => void;
  registerPolicyCheckCallback: (fn: PolicyCheckCallback) => () => void;
}

const FilesystemContext = createContext<FilesystemContextValue | null>(null);

export function FilesystemContextProvider({ children }: PropsWithChildren) {
  const callbacksRef = useRef<Set<RefreshCallback>>(new Set());
  const policyCallbacksRef = useRef<Set<PolicyCheckCallback>>(new Set());

  const notifyFileChanged = (path?: string) => {
    for (const cb of callbacksRef.current) {
      cb(path);
    }
  };

  const registerRefreshCallback = (fn: RefreshCallback) => {
    callbacksRef.current.add(fn);
    return () => {
      callbacksRef.current.delete(fn);
    };
  };

  const notifyPolicyCheck = (event: PolicyCheckEvent) => {
    for (const cb of policyCallbacksRef.current) {
      cb(event);
    }
  };

  const registerPolicyCheckCallback = (fn: PolicyCheckCallback) => {
    policyCallbacksRef.current.add(fn);
    return () => {
      policyCallbacksRef.current.delete(fn);
    };
  };

  return (
    <FilesystemContext.Provider
      value={{
        notifyFileChanged,
        registerRefreshCallback,
        notifyPolicyCheck,
        registerPolicyCheckCallback,
      }}
    >
      {children}
    </FilesystemContext.Provider>
  );
}

export function useFilesystemContext(): FilesystemContextValue {
  const ctx = useContext(FilesystemContext);
  if (!ctx) throw new Error("useFilesystemContext must be used inside FilesystemContextProvider");
  return ctx;
}
