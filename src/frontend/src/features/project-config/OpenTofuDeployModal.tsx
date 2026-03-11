import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

import { applyOpenTofuDeployStream, planOpenTofuDeployStream, previewOpenTofuDeploy, type OpenTofuPreviewResult, type OpenTofuStatus } from "../../api/projects/index";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Textarea } from "../../components/ui/textarea";
import { readSseJson } from "../../lib/sse";

type WorkflowMode = "plan" | "apply";
type RunStatus = "ok" | "failed" | null;
type DeployEvent = Record<string, unknown>;

interface OpenTofuDeployModalProps {
  projectId: string;
  status: OpenTofuStatus;
  onClose: () => void;
}

function useDeployModalState() {
  const [intent, setIntent] = useState("");
  const [preview, setPreview] = useState<OpenTofuPreviewResult | null>(null);
  const [selectedModules, setSelectedModules] = useState<string[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [runStatus, setRunStatus] = useState<RunStatus>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState("");
  return {
    intent, setIntent, preview, setPreview, selectedModules, setSelectedModules, loadingPreview, setLoadingPreview, planning, setPlanning, applying, setApplying, runStatus, setRunStatus, logs, setLogs, error, setError,
  };
}

function clearRunOutput(
  setRunStatus: (value: RunStatus) => void,
  setError: (value: string) => void,
  setLogs: Dispatch<SetStateAction<string[]>>,
) {
  setRunStatus(null);
  setError("");
  setLogs([]);
}

function setRunBusy(mode: WorkflowMode, busy: boolean, setPlanning: (value: boolean) => void, setApplying: (value: boolean) => void) {
  if (mode === "plan") setPlanning(busy);
  else setApplying(busy);
}

function toggleSelectedModule(previous: string[], moduleName: string) {
  return previous.includes(moduleName) ? previous.filter((value) => value !== moduleName) : [...previous, moduleName];
}

function appendRunLog(setLogs: Dispatch<SetStateAction<string[]>>, line: string) {
  setLogs((previous) => [...previous, line]);
}

function toEventType(event: DeployEvent) {
  return String(event.type ?? "");
}

function toEventModules(event: DeployEvent) {
  return Array.isArray(event.modules) ? event.modules.map((module) => String(module)) : [];
}

function handleRunStartEvent(type: string, event: DeployEvent, appendLog: (line: string) => void) {
  const prefix = type === "plan.start" ? "Starting plan" : "Starting deploy";
  appendLog(`${prefix}: ${toEventModules(event).join(", ")}`);
}

function handleModuleStartEvent(event: DeployEvent, appendLog: (line: string) => void) {
  appendLog(`\n==> Module: ${String(event.module ?? "")}`);
}

function handleModuleDoneEvent(event: DeployEvent, appendLog: (line: string) => void) {
  appendLog(`Module ${String(event.module ?? "")}: ${String(event.status ?? "")}`);
}

function handleRunErrorEvent(event: DeployEvent, setError: (value: string) => void) {
  setError(String(event.message ?? "Apply failed"));
}

function handleRunDoneEvent(event: DeployEvent, setRunStatus: (value: RunStatus) => void) {
  setRunStatus(event.status === "ok" ? "ok" : "failed");
}

function handleDeployEvent(
  event: DeployEvent,
  appendLog: (line: string) => void,
  setError: (value: string) => void,
  setRunStatus: (value: RunStatus) => void,
) {
  const type = toEventType(event);
  if (type === "deploy.start" || type === "plan.start") return handleRunStartEvent(type, event, appendLog);
  if (type === "module.start") return handleModuleStartEvent(event, appendLog);
  if (type === "log") return appendLog(String(event.line ?? ""));
  if (type === "module.done") return handleModuleDoneEvent(event, appendLog);
  if (type === "error") return handleRunErrorEvent(event, setError);
  if (type === "deploy.done" || type === "plan.done") handleRunDoneEvent(event, setRunStatus);
}

async function requestRunStream(projectId: string, mode: WorkflowMode, selectedModules: string[], intent: string) {
  if (mode === "apply") return applyOpenTofuDeployStream(projectId, selectedModules, intent);
  return planOpenTofuDeployStream(projectId, selectedModules, intent);
}

function assertRunStreamResponse(response: Response, mode: WorkflowMode) {
  if (response.ok && response.body) return;
  const label = mode === "apply" ? "Apply" : "Plan";
  throw new Error(`${label} request failed (${response.status})`);
}

function useLoadPreview(args: {
  projectId: string;
  intent: string;
  setLoadingPreview: (value: boolean) => void;
  setPreview: (value: OpenTofuPreviewResult | null) => void;
  setSelectedModules: Dispatch<SetStateAction<string[]>>;
  setError: (value: string) => void;
  setRunStatus: (value: RunStatus) => void;
  setLogs: Dispatch<SetStateAction<string[]>>;
}) {
  return useCallback(async () => {
    args.setLoadingPreview(true);
    clearRunOutput(args.setRunStatus, args.setError, args.setLogs);
    try {
      const data = await previewOpenTofuDeploy(args.projectId, args.intent);
      args.setPreview(data);
      args.setSelectedModules(data.selected_modules ?? []);
      if (data.status !== "ok") args.setError(data.message ?? "Preview failed");
    } catch (error: unknown) {
      args.setError(error instanceof Error ? error.message : "Preview failed");
    } finally {
      args.setLoadingPreview(false);
    }
  }, [args]);
}

function useRunWorkflow(args: {
  projectId: string;
  intent: string;
  selectedModules: string[];
  setPlanning: (value: boolean) => void;
  setApplying: (value: boolean) => void;
  setRunStatus: (value: RunStatus) => void;
  setError: (value: string) => void;
  setLogs: Dispatch<SetStateAction<string[]>>;
}) {
  return useCallback(async (mode: WorkflowMode) => {
    if (args.selectedModules.length < 1) return args.setError("Select at least one module");
    setRunBusy(mode, true, args.setPlanning, args.setApplying);
    clearRunOutput(args.setRunStatus, args.setError, args.setLogs);
    try {
      const response = await requestRunStream(args.projectId, mode, args.selectedModules, args.intent);
      assertRunStreamResponse(response, mode);
      for await (const rawEvent of readSseJson(response)) {
        handleDeployEvent(rawEvent as DeployEvent, (line) => appendRunLog(args.setLogs, line), args.setError, args.setRunStatus);
      }
    } catch (error: unknown) {
      args.setError(error instanceof Error ? error.message : "Run failed");
      args.setRunStatus("failed");
    } finally {
      setRunBusy(mode, false, args.setPlanning, args.setApplying);
    }
  }, [args]);
}

function OpenTofuStatusAlerts({ status }: { status: OpenTofuStatus }) {
  if (!status.opentofu_available) {
    return (
      <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-100">
        <AlertTitle>OpenTofu unavailable</AlertTitle>
        <AlertDescription>OpenTofu CLI is not available on backend host.</AlertDescription>
      </Alert>
    );
  }
  if (status.credential_ready) return null;
  return (
    <Alert className="border-blue-500/40 bg-blue-500/10 text-blue-100">
      <AlertTitle>Plan available without credentials</AlertTitle>
      <AlertDescription>Run Plan to check changes. Add credentials to use Apply.</AlertDescription>
    </Alert>
  );
}

function DeployIntentInput({
  intent,
  canPreview,
  loadingPreview,
  onIntentChange,
  onLoadPreview,
}: {
  intent: string;
  canPreview: boolean;
  loadingPreview: boolean;
  onIntentChange: (value: string) => void;
  onLoadPreview: () => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-[1fr_auto]">
      <Textarea value={intent} onChange={(event) => onIntentChange(event.target.value)} placeholder="Optional deploy intent" className="min-h-24" />
      <Button onClick={onLoadPreview} disabled={loadingPreview || !canPreview}>{loadingPreview ? "Previewing..." : "Preview Targets"}</Button>
    </div>
  );
}

function PreviewModulesCard({
  preview,
  selectedModules,
  onToggleModule,
}: {
  preview: OpenTofuPreviewResult | null;
  selectedModules: string[];
  onToggleModule: (moduleName: string) => void;
}) {
  if (!preview) return null;
  return (
    <Card className="bg-[var(--da-elevated)]">
      <CardHeader>
        <CardTitle className="text-base">Agent rationale</CardTitle>
        <CardDescription>{preview.reason}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {preview.modules.map((moduleName) => (
          <label key={moduleName} className="flex items-center gap-2 text-sm text-[var(--da-text)]">
            <input type="checkbox" checked={selectedModules.includes(moduleName)} onChange={() => onToggleModule(moduleName)} />
            <code>{moduleName}</code>
          </label>
        ))}
        {preview.modules.length < 1 ? <p className="text-sm text-[var(--da-muted)]">No modules found.</p> : null}
      </CardContent>
    </Card>
  );
}

function DeployActionBar({
  runStatus,
  canPlan,
  canApply,
  planning,
  applying,
  onRun,
}: {
  runStatus: RunStatus;
  canPlan: boolean;
  canApply: boolean;
  planning: boolean;
  applying: boolean;
  onRun: (mode: WorkflowMode) => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      {runStatus === "ok" ? <span className="text-xs text-green-300">Completed successfully</span> : null}
      {runStatus === "failed" ? <span className="text-xs text-red-300">Run failed</span> : null}
      <Button variant="outline" onClick={() => onRun("plan")} disabled={!canPlan}>{planning ? "Planning..." : "Run Plan"}</Button>
      <Button onClick={() => onRun("apply")} disabled={!canApply}>{applying ? "Applying..." : "Confirm & Apply"}</Button>
    </div>
  );
}

function DeployErrorAlert({ error }: { error: string }) {
  if (!error) return null;
  return (
    <Alert className="border-red-500/40 bg-red-500/10 text-red-100">
      <AlertTitle>Error</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}

function DeployLogsPanel({ logs }: { logs: string[] }) {
  return (
    <ScrollArea className="h-52 rounded-md border border-[var(--da-border)] bg-[var(--da-bg)] p-3 font-mono text-xs text-blue-100/90">
      {logs.length < 1 ? <p className="text-[var(--da-muted)]">Run logs will appear here...</p> : logs.map((line, index) => <div key={`${index}-${line.slice(0, 12)}`}>{line}</div>)}
    </ScrollArea>
  );
}

function useDeployModalViewModel(projectId: string, status: OpenTofuStatus, state: ReturnType<typeof useDeployModalState>) {
  const canPreview = status.opentofu_available;
  const canPlan = !state.applying && !state.planning && state.selectedModules.length > 0 && status.opentofu_available;
  const canApply = canPlan && status.credential_ready;
  const loadPreview = useLoadPreview({
    projectId,
    intent: state.intent,
    setLoadingPreview: state.setLoadingPreview,
    setPreview: state.setPreview,
    setSelectedModules: state.setSelectedModules,
    setError: state.setError,
    setRunStatus: state.setRunStatus,
    setLogs: state.setLogs,
  });
  const runWorkflow = useRunWorkflow({
    projectId,
    intent: state.intent,
    selectedModules: state.selectedModules,
    setPlanning: state.setPlanning,
    setApplying: state.setApplying,
    setRunStatus: state.setRunStatus,
    setError: state.setError,
    setLogs: state.setLogs,
  });
  return { canPreview, canPlan, canApply, loadPreview, runWorkflow };
}

function OpenTofuDeployDialogContent({
  status,
  state,
  view,
}: {
  status: OpenTofuStatus;
  state: ReturnType<typeof useDeployModalState>;
  view: ReturnType<typeof useDeployModalViewModel>;
}) {
  return (
    <DialogContent className="max-w-4xl">
      <DialogHeader>
        <DialogTitle>OpenTofu Deploy</DialogTitle>
        <DialogDescription>Preview target modules then run plan/apply with streaming logs.</DialogDescription>
      </DialogHeader>
      <OpenTofuStatusAlerts status={status} />
      <DeployIntentInput intent={state.intent} canPreview={view.canPreview} loadingPreview={state.loadingPreview} onIntentChange={state.setIntent} onLoadPreview={() => void view.loadPreview()} />
      <PreviewModulesCard preview={state.preview} selectedModules={state.selectedModules} onToggleModule={(moduleName) => state.setSelectedModules((previous) => toggleSelectedModule(previous, moduleName))} />
      <DeployActionBar runStatus={state.runStatus} canPlan={view.canPlan} canApply={view.canApply} planning={state.planning} applying={state.applying} onRun={(mode) => void view.runWorkflow(mode)} />
      <DeployErrorAlert error={state.error} />
      <DeployLogsPanel logs={state.logs} />
    </DialogContent>
  );
}

export function OpenTofuDeployModal({ projectId, status, onClose }: OpenTofuDeployModalProps) {
  const state = useDeployModalState();
  const view = useDeployModalViewModel(projectId, status, state);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <OpenTofuDeployDialogContent status={status} state={state} view={view} />
    </Dialog>
  );
}
