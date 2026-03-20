import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

import {
  enqueueProjectJob,
  getOpenTofuStatus,
  streamProjectJobEvents,
  type OpenTofuStatus,
  type ProjectJobEvent,
} from "../../../api/projects/index";
import { readSseJson } from "../../../lib/sse";
import type { WorkflowProblem, WorkflowProblemMode } from "../types";

type WorkflowMode = "plan" | "apply" | "pipeline";
type WorkflowTab = "logs" | "problems";
type SseEvent = Record<string, unknown>;

type PushProblemFn = (
  mode: WorkflowProblemMode,
  message: string,
  options?: Omit<WorkflowProblem, "id" | "at" | "mode" | "message">,
) => void;

function createProblemId(index: number) {
  return `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
}

function appendProblemRecords(
  previous: WorkflowProblem[],
  problems: Array<Omit<WorkflowProblem, "id" | "at">>,
  stamp: string,
) {
  const next = problems.map((problem, index) => ({ ...problem, id: createProblemId(index), at: stamp }));
  return [...next, ...previous].slice(0, 120);
}

function useAppendProblems(
  setWorkflowProblems: Dispatch<SetStateAction<WorkflowProblem[]>>,
  setWorkflowTab: Dispatch<SetStateAction<WorkflowTab>>,
) {
  return useCallback((problems: Array<Omit<WorkflowProblem, "id" | "at">>, options?: { switchToProblems?: boolean }) => {
    if (problems.length < 1) return;
    const stamp = new Date().toLocaleTimeString([], { hour12: false });
    setWorkflowProblems((previous) => appendProblemRecords(previous, problems, stamp));
    if (options?.switchToProblems ?? true) setWorkflowTab("problems");
  }, [setWorkflowProblems, setWorkflowTab]);
}

function usePushProblem(
  appendProblems: (problems: Array<Omit<WorkflowProblem, "id" | "at">>, options?: { switchToProblems?: boolean }) => void,
) {
  return useCallback((mode: WorkflowProblemMode, message: string, options?: Omit<WorkflowProblem, "id" | "at" | "mode" | "message">) => {
    appendProblems([{ mode, message, module: options?.module, stage: options?.stage, severity: options?.severity, path: options?.path, line: options?.line, ruleId: options?.ruleId, source: options?.source }], { switchToProblems: true });
  }, [appendProblems]);
}

function useResetWorkflow(
  setWorkflowBusy: Dispatch<SetStateAction<WorkflowMode | null>>,
  setWorkflowError: Dispatch<SetStateAction<string>>,
  setWorkflowTab: Dispatch<SetStateAction<WorkflowTab>>,
  setWorkflowProblems: Dispatch<SetStateAction<WorkflowProblem[]>>,
) {
  return useCallback(() => {
    setWorkflowBusy(null);
    setWorkflowError("");
    setWorkflowTab("logs");
    setWorkflowProblems([]);
  }, [setWorkflowBusy, setWorkflowError, setWorkflowProblems, setWorkflowTab]);
}

function getActionLabel(mode: WorkflowMode) {
  if (mode === "apply") return "apply";
  if (mode === "pipeline") return "pipeline";
  return "plan";
}

const DEPLOY_GATE_MESSAGES: Record<string, string> = {
  saved_credentials_incomplete:
    "Saved AWS credentials are incomplete. Finish the Credentials section before apply or destroy.",
  generation_readiness_required: "Generate Terraform and Ansible artifacts before continuing.",
  plan_review_required: "Review the latest plan in this session before continuing.",
  destroy_plan_review_required: "Run and review a destroy plan in this session before continuing.",
  partial_scope_confirmation_required: "Acknowledge the advanced partial-scope warning before continuing.",
  drift_refresh_required: "Refresh drift on the primary state backend before continuing.",
  destroy_confirmation_required: "Type the project name and destroy before starting destroy.",
};

function toDeployGateProblem(code: string) {
  const guidance = DEPLOY_GATE_MESSAGES[code];
  if (!guidance) return null;
  return `${guidance} Resolve it in the Deploy modal before retrying.`;
}

function ensureWorkflowReady(status: OpenTofuStatus, _mode: WorkflowMode) {
  if (!status.opentofu_available) throw new Error("OpenTofu workflow is unavailable. Configure runners first.");
  if (!status.modules || status.modules.length < 1) throw new Error("No OpenTofu modules found for this project.");
  return status.modules;
}

async function getSelectedModules(projectId: string, mode: WorkflowMode) {
  const status = await getOpenTofuStatus(projectId);
  return ensureWorkflowReady(status, mode);
}

function toEvent(value: unknown): SseEvent {
  return typeof value === "object" && value !== null ? (value as SseEvent) : {};
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry));
}

function resolveModuleFailureReason(event: SseEvent, stage: string | undefined) {
  const reason = asString(event.reason);
  if (reason) return reason;
  const message = asString(event.message);
  if (message) return message;
  return stage ? `stage ${stage}` : "unknown reason";
}

function handleWorkflowStartEvent(event: SseEvent, pushLog: (message: string) => void) {
  const type = asString(event.type);
  const prefix = type === "plan.start" ? "Starting plan" : type === "pipeline.start" ? "Starting pipeline" : "Starting deploy";
  pushLog(`${prefix}: ${asStringArray(event.modules).join(", ") || asStringArray(event.selected_modules).join(", ")}`);
}

function handleModuleDoneEvent(args: {
  event: SseEvent;
  mode: WorkflowMode;
  pushLog: (message: string) => void;
  pushProblem: PushProblemFn;
  setWorkflowError: (value: string) => void;
}) {
  const moduleName = asString(args.event.module);
  const statusText = asString(args.event.status);
  const stage = asString(args.event.stage) || undefined;
  args.pushLog(`Module ${moduleName}: ${statusText}`);
  if (statusText !== "failed") return;
  const reason = resolveModuleFailureReason(args.event, stage);
  const message = `Module ${moduleName} failed: ${reason}`;
  args.setWorkflowError(message);
  args.pushProblem(args.mode, message, { module: moduleName, stage });
}

function handleWorkflowErrorEvent(args: {
  event: SseEvent;
  mode: WorkflowMode;
  pushLog: (message: string) => void;
  pushProblem: PushProblemFn;
  setWorkflowError: (value: string) => void;
}) {
  const code = asString(args.event.code);
  const deployGateProblem = toDeployGateProblem(code);
  const message = deployGateProblem ?? asString(args.event.message, "Workflow failed");
  args.setWorkflowError(message);
  args.pushLog(`Error: ${message}`);
  args.pushProblem(args.mode, message, {
    module: asString(args.event.module) || undefined,
    stage: asString(args.event.stage) || undefined,
    source: deployGateProblem ? "deploy-gate" : undefined,
  });
}

function handleWorkflowDoneEvent(args: {
  event: SseEvent;
  mode: WorkflowMode;
  actionLabel: string;
  pushLog: (message: string) => void;
  pushProblem: PushProblemFn;
  setWorkflowError: (value: string) => void;
}) {
  const status = asString(args.event.status);
  const ok = status === "ok" || status === "succeeded";
  args.pushLog(ok ? `Workflow ${args.actionLabel} completed` : `Workflow ${args.actionLabel} failed`);
  if (ok) return;
  const message = `Workflow ${args.actionLabel} failed`;
  args.setWorkflowError(message);
  args.pushProblem(args.mode, message);
}

function handlePipelineStageDoneEvent(args: {
  event: SseEvent;
  mode: WorkflowMode;
  pushLog: (message: string) => void;
  pushProblem: PushProblemFn;
  setWorkflowError: (value: string) => void;
}) {
  const type = asString(args.event.type);
  const stageName = type === "deploy.done" ? "Provisioning" : "Configuration";
  const status = asString(args.event.status);
  const ok = status === "ok" || status === "succeeded";
  args.pushLog(ok ? `${stageName} stage completed` : `${stageName} stage failed`);
  if (ok) return;
  const message = `${stageName} stage failed`;
  args.setWorkflowError(message);
  args.pushProblem(args.mode, message, { stage: type === "deploy.done" ? "apply" : "ansible" });
}

function handleConfigEvent(event: SseEvent, pushLog: (message: string) => void) {
  const type = asString(event.type);
  if (type === "config.start") {
    pushLog("=== Configuration Stage ===");
    const modules = asStringArray(event.modules);
    if (modules.length > 0) pushLog(`Starting configuration for modules: ${modules.join(", ")}`);
    return;
  }
  if (type === "host.start") {
    pushLog(`--> Host: ${asString(event.host)} (attempt ${asString(event.attempt, "1")})`);
    return;
  }
  if (type === "task.log") {
    pushLog(asString(event.line));
    return;
  }
  if (type === "host.done") {
    pushLog(`Host ${asString(event.host)}: ${asString(event.status)}`);
  }
}

function handleJobMetaEvent(event: SseEvent, pushLog: (message: string) => void) {
  const type = asString(event.type);
  if (type === "job.queued") pushLog("Job queued");
  if (type === "job.running") pushLog("Job started");
  if (type === "job.cancel_requested") pushLog("Cancel requested");
  if (type === "job.canceled") pushLog("Job canceled");
}

function handleWorkflowEvent(args: {
  rawEvent: unknown;
  mode: WorkflowMode;
  actionLabel: string;
  pushLog: (message: string) => void;
  pushProblem: PushProblemFn;
  setWorkflowError: (value: string) => void;
}) {
  const event = toEvent(args.rawEvent as ProjectJobEvent);
  const type = asString(event.type);
  if (type === "deploy.start" || type === "plan.start" || type === "pipeline.start") return handleWorkflowStartEvent(event, args.pushLog);
  if (type === "module.start") return args.pushLog(`==> Module: ${asString(event.module)}`);
  if (type === "log") return args.pushLog(asString(event.line));
  if (type === "module.done") return handleModuleDoneEvent({ event, mode: args.mode, pushLog: args.pushLog, pushProblem: args.pushProblem, setWorkflowError: args.setWorkflowError });
  if (type === "error") return handleWorkflowErrorEvent({ event, mode: args.mode, pushLog: args.pushLog, pushProblem: args.pushProblem, setWorkflowError: args.setWorkflowError });
  if (type === "config.start" || type === "host.start" || type === "task.log" || type === "host.done") {
    return handleConfigEvent(event, args.pushLog);
  }
  if ((type === "deploy.done" || type === "config.done") && args.mode === "pipeline") {
    return handlePipelineStageDoneEvent({ event, mode: args.mode, pushLog: args.pushLog, pushProblem: args.pushProblem, setWorkflowError: args.setWorkflowError });
  }
  if (type === "deploy.done" || type === "plan.done" || type === "pipeline.done" || type === "job.terminal") {
    return handleWorkflowDoneEvent({ event, mode: args.mode, actionLabel: args.actionLabel, pushLog: args.pushLog, pushProblem: args.pushProblem, setWorkflowError: args.setWorkflowError });
  }
  if (type.startsWith("job.")) return handleJobMetaEvent(event, args.pushLog);
}

function startWorkflowRun(
  mode: WorkflowMode,
  actionLabel: string,
  setWorkflowBusy: (value: WorkflowMode | null) => void,
  setWorkflowError: (value: string) => void,
  setWorkflowTab: (value: WorkflowTab) => void,
  setWorkflowProblems: (value: WorkflowProblem[]) => void,
  pushLog: (message: string) => void,
) {
  setWorkflowBusy(mode);
  setWorkflowError("");
  setWorkflowTab("logs");
  setWorkflowProblems([]);
  pushLog(`Starting workflow: ${actionLabel}`);
}

function handleWorkflowFailure(
  error: unknown,
  actionLabel: string,
  mode: WorkflowMode,
  setWorkflowError: (value: string) => void,
  pushLog: (message: string) => void,
  pushProblem: PushProblemFn,
) {
  const message = error instanceof Error ? error.message : `Failed to run ${actionLabel}`;
  setWorkflowError(message);
  pushLog(`Error: ${message}`);
  pushProblem(mode, message);
}

function handleAuthRequiredRun(
  mode: WorkflowMode,
  setWorkflowError: (value: string) => void,
  pushLog: (message: string) => void,
  pushProblem: PushProblemFn,
) {
  const message = "Login required to run OpenTofu workflows.";
  setWorkflowError(message);
  pushLog(`Error: ${message}`);
  pushProblem(mode, message);
}

async function runWorkflowStream(args: {
  projectId: string;
  mode: WorkflowMode;
  actionLabel: string;
  pushLog: (message: string) => void;
  pushProblem: PushProblemFn;
  setWorkflowError: (value: string) => void;
}) {
  const selectedModules = await getSelectedModules(args.projectId, args.mode);
  const job = await enqueueProjectJob(args.projectId, {
    kind: args.mode,
    selected_modules: selectedModules,
    intent: "",
    options: {},
  });
  const response = await streamProjectJobEvents(args.projectId, job.id);
  if (!response.ok || !response.body) {
    throw new Error(`Workflow stream failed (${response.status})`);
  }
  for await (const rawEvent of readSseJson(response)) {
    handleWorkflowEvent({
      rawEvent,
      mode: args.mode,
      actionLabel: args.actionLabel,
      pushLog: args.pushLog,
      pushProblem: args.pushProblem,
      setWorkflowError: args.setWorkflowError,
    });
  }
}

function useRunWorkflow(args: {
  projectId: string;
  authenticated: boolean;
  workflowBusy: WorkflowMode | null;
  pushLog: (message: string) => void;
  pushProblem: PushProblemFn;
  setWorkflowBusy: (value: WorkflowMode | null) => void;
  setWorkflowError: (value: string) => void;
  setWorkflowTab: (value: WorkflowTab) => void;
  setWorkflowProblems: (value: WorkflowProblem[]) => void;
}) {
  return useCallback(async (mode: WorkflowMode) => {
    if (args.workflowBusy) return;
    if (!args.authenticated) return handleAuthRequiredRun(mode, args.setWorkflowError, args.pushLog, args.pushProblem);
    const actionLabel = getActionLabel(mode);
    startWorkflowRun(mode, actionLabel, args.setWorkflowBusy, args.setWorkflowError, args.setWorkflowTab, args.setWorkflowProblems, args.pushLog);
    try {
      await runWorkflowStream({ projectId: args.projectId, mode, actionLabel, pushLog: args.pushLog, pushProblem: args.pushProblem, setWorkflowError: args.setWorkflowError });
    } catch (error: unknown) {
      handleWorkflowFailure(error, actionLabel, mode, args.setWorkflowError, args.pushLog, args.pushProblem);
    } finally {
      args.setWorkflowBusy(null);
    }
  }, [args]);
}

function buildWorkflowRunnerResult(params: {
  workflowBusy: WorkflowMode | null;
  workflowError: string;
  workflowTab: WorkflowTab;
  setWorkflowTab: Dispatch<SetStateAction<WorkflowTab>>;
  workflowProblems: WorkflowProblem[];
  handleRunWorkflow: (mode: WorkflowMode) => Promise<void>;
  appendProblems: (problems: Array<Omit<WorkflowProblem, "id" | "at">>, options?: { switchToProblems?: boolean }) => void;
  resetWorkflow: () => void;
}) {
  return {
    workflowBusy: params.workflowBusy,
    workflowError: params.workflowError,
    workflowTab: params.workflowTab,
    setWorkflowTab: params.setWorkflowTab,
    workflowProblems: params.workflowProblems,
    handleRunWorkflow: params.handleRunWorkflow,
    appendProblems: params.appendProblems,
    resetWorkflow: params.resetWorkflow,
  };
}

export function useWorkflowRunner({ projectId, authenticated, pushLog }: { projectId: string; authenticated: boolean; pushLog: (message: string) => void; }) {
  const [workflowBusy, setWorkflowBusy] = useState<WorkflowMode | null>(null);
  const [workflowError, setWorkflowError] = useState("");
  const [workflowTab, setWorkflowTab] = useState<WorkflowTab>("logs");
  const [workflowProblems, setWorkflowProblems] = useState<WorkflowProblem[]>([]);
  const appendProblems = useAppendProblems(setWorkflowProblems, setWorkflowTab);
  const pushProblem = usePushProblem(appendProblems);
  const resetWorkflow = useResetWorkflow(setWorkflowBusy, setWorkflowError, setWorkflowTab, setWorkflowProblems);
  const handleRunWorkflow = useRunWorkflow({
    projectId,
    authenticated,
    workflowBusy,
    pushLog,
    pushProblem,
    setWorkflowBusy,
    setWorkflowError,
    setWorkflowTab,
    setWorkflowProblems,
  });
  return buildWorkflowRunnerResult({
    workflowBusy,
    workflowError,
    workflowTab,
    setWorkflowTab,
    workflowProblems,
    handleRunWorkflow,
    appendProblems,
    resetWorkflow,
  });
}
