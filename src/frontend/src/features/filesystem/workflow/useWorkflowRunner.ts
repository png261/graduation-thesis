import { useCallback, useState } from "react";

import {
  applyOpenTofuDeployStream,
  getOpenTofuStatus,
  planOpenTofuDeployStream,
} from "../../../api/projects/index";
import { readSseJson } from "../../../lib/sse";
import type { WorkflowProblem, WorkflowProblemMode } from "../types";

export function useWorkflowRunner({
  projectId,
  authenticated,
  pushLog,
}: {
  projectId: string;
  authenticated: boolean;
  pushLog: (message: string) => void;
}) {
  const [workflowBusy, setWorkflowBusy] = useState<"plan" | "apply" | null>(null);
  const [workflowError, setWorkflowError] = useState("");
  const [workflowTab, setWorkflowTab] = useState<"logs" | "problems">("logs");
  const [workflowProblems, setWorkflowProblems] = useState<WorkflowProblem[]>([]);

  const appendProblems = useCallback(
    (
      problems: Array<Omit<WorkflowProblem, "id" | "at">>,
      options?: { switchToProblems?: boolean },
    ) => {
      if (problems.length === 0) return;
      const stamp = new Date().toLocaleTimeString([], { hour12: false });
      setWorkflowProblems((prev) => [
        ...problems.map((problem, idx) => ({
          ...problem,
          id: `${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
          at: stamp,
        })),
        ...prev,
      ].slice(0, 120));
      if (options?.switchToProblems ?? true) {
        setWorkflowTab("problems");
      }
    },
    [],
  );

  const pushProblem = useCallback(
    (
      mode: WorkflowProblemMode,
      message: string,
      options?: Omit<WorkflowProblem, "id" | "at" | "mode" | "message">,
    ) => {
      appendProblems(
        [
          {
            mode,
            message,
            module: options?.module,
            stage: options?.stage,
            severity: options?.severity,
            path: options?.path,
            line: options?.line,
            ruleId: options?.ruleId,
            source: options?.source,
          },
        ],
        { switchToProblems: true },
      );
    },
    [appendProblems],
  );

  const resetWorkflow = useCallback(() => {
    setWorkflowBusy(null);
    setWorkflowError("");
    setWorkflowTab("logs");
    setWorkflowProblems([]);
  }, []);

  const handleRunWorkflow = useCallback(
    async (mode: "plan" | "apply") => {
      if (workflowBusy) return;
      if (!authenticated) {
        const message = "Login required to run OpenTofu workflows.";
        setWorkflowError(message);
        pushLog(`Error: ${message}`);
        pushProblem(mode, message);
        return;
      }

      const actionLabel = mode === "apply" ? "apply" : "plan";
      setWorkflowBusy(mode);
      setWorkflowError("");
      setWorkflowTab("logs");
      setWorkflowProblems([]);
      pushLog(`Starting workflow: ${actionLabel}`);

      try {
        const status = await getOpenTofuStatus(projectId);
        if (!status.opentofu_available) {
          throw new Error("OpenTofu workflow is unavailable. Configure runners first.");
        }
        if (mode === "apply" && !status.credential_ready) {
          const missing =
            status.missing_credentials && status.missing_credentials.length > 0
              ? `Missing credentials: ${status.missing_credentials.join(", ")}`
              : "Missing required cloud credentials.";
          throw new Error(missing);
        }

        const selectedModules = status.modules ?? [];
        if (selectedModules.length === 0) {
          throw new Error("No OpenTofu modules found for this project.");
        }

        const response =
          mode === "apply"
            ? await applyOpenTofuDeployStream(projectId, selectedModules, "")
            : await planOpenTofuDeployStream(projectId, selectedModules, "");

        if (!response.ok || !response.body) {
          throw new Error(`${mode === "apply" ? "Apply" : "Plan"} request failed (${response.status})`);
        }

        for await (const event of readSseJson(response)) {
          const type = String(event?.type ?? "");
          if (type === "deploy.start" || type === "plan.start") {
            const prefix = type === "plan.start" ? "Starting plan" : "Starting deploy";
            pushLog(`${prefix}: ${(event.modules ?? []).join(", ")}`);
            continue;
          }
          if (type === "module.start") {
            pushLog(`==> Module: ${String(event.module ?? "")}`);
            continue;
          }
          if (type === "log") {
            pushLog(String(event.line ?? ""));
            continue;
          }
          if (type === "module.done") {
            const moduleName = String(event.module ?? "");
            const statusText = String(event.status ?? "");
            const stage = typeof event.stage === "string" ? event.stage : undefined;
            pushLog(`Module ${moduleName}: ${statusText}`);
            if (statusText === "failed") {
              const reason =
                (typeof event.reason === "string" && event.reason) ||
                (typeof event.message === "string" && event.message) ||
                (stage ? `stage ${stage}` : "unknown reason");
              const problemMessage = `Module ${moduleName} failed: ${reason}`;
              setWorkflowError(problemMessage);
              pushProblem(mode, problemMessage, { module: moduleName, stage });
            }
            continue;
          }
          if (type === "error") {
            const message = String(event.message ?? "Workflow failed");
            setWorkflowError(message);
            pushLog(`Error: ${message}`);
            pushProblem(mode, message, {
              module: typeof event.module === "string" ? event.module : undefined,
              stage: typeof event.stage === "string" ? event.stage : undefined,
            });
            continue;
          }
          if (type === "deploy.done" || type === "plan.done") {
            const ok = event.status === "ok";
            pushLog(ok ? `Workflow ${actionLabel} completed` : `Workflow ${actionLabel} failed`);
            if (!ok) {
              const message = `Workflow ${actionLabel} failed`;
              setWorkflowError(message);
              pushProblem(mode, message);
            }
          }
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : `Failed to run ${actionLabel}`;
        setWorkflowError(message);
        pushLog(`Error: ${message}`);
        pushProblem(mode, message);
      } finally {
        setWorkflowBusy(null);
      }
    },
    [projectId, authenticated, pushLog, pushProblem, workflowBusy],
  );

  return {
    workflowBusy,
    workflowError,
    workflowTab,
    setWorkflowTab,
    workflowProblems,
    handleRunWorkflow,
    appendProblems,
    resetWorkflow,
  };
}
