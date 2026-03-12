import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";

import {
  applyOpenTofuDeployStream,
  getAnsibleStatus,
  getOpenTofuGraph,
  planOpenTofuDeployStream,
  previewOpenTofuDeploy,
  runAnsibleConfigStream,
  type AnsibleStatus,
  type OpenTofuGraphResult,
  type OpenTofuPreviewResult,
  type OpenTofuStatus,
} from "../../api/projects/index";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Textarea } from "../../components/ui/textarea";
import { readSseJson } from "../../lib/sse";

type WorkflowMode = "plan" | "apply";
type RunStatus = "ok" | "failed" | null;
type ConfigRunStatus = "ok" | "failed" | null;
type DeployEvent = Record<string, unknown>;
type ConfigEvent = Record<string, unknown>;

interface OpenTofuDeployModalProps {
  projectId: string;
  status: OpenTofuStatus;
  onClose: () => void;
}

function useDeployModalState() {
  const [intent, setIntent] = useState("");
  const [overridePolicy, setOverridePolicy] = useState(false);
  const [preview, setPreview] = useState<OpenTofuPreviewResult | null>(null);
  const [selectedModules, setSelectedModules] = useState<string[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [runStatus, setRunStatus] = useState<RunStatus>(null);
  const [configRunStatus, setConfigRunStatus] = useState<ConfigRunStatus>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [ansibleStatus, setAnsibleStatus] = useState<AnsibleStatus | null>(null);
  const [loadingAnsibleStatus, setLoadingAnsibleStatus] = useState(false);
  const [infraGraph, setInfraGraph] = useState<OpenTofuGraphResult | null>(null);
  const [loadingInfraGraph, setLoadingInfraGraph] = useState(false);
  const [infraGraphError, setInfraGraphError] = useState("");
  return {
    intent,
    setIntent,
    overridePolicy,
    setOverridePolicy,
    preview,
    setPreview,
    selectedModules,
    setSelectedModules,
    loadingPreview,
    setLoadingPreview,
    planning,
    setPlanning,
    applying,
    setApplying,
    configuring,
    setConfiguring,
    runStatus,
    setRunStatus,
    configRunStatus,
    setConfigRunStatus,
    logs,
    setLogs,
    error,
    setError,
    ansibleStatus,
    setAnsibleStatus,
    loadingAnsibleStatus,
    setLoadingAnsibleStatus,
    infraGraph,
    setInfraGraph,
    loadingInfraGraph,
    setLoadingInfraGraph,
    infraGraphError,
    setInfraGraphError,
  };
}

function clearRunOutput(
  setRunStatus: (value: RunStatus) => void,
  setConfigRunStatus: (value: ConfigRunStatus) => void,
  setError: (value: string) => void,
  setLogs: Dispatch<SetStateAction<string[]>>,
) {
  setRunStatus(null);
  setConfigRunStatus(null);
  setError("");
  setLogs([]);
}

function setRunBusy(
  mode: WorkflowMode,
  busy: boolean,
  setPlanning: (value: boolean) => void,
  setApplying: (value: boolean) => void,
) {
  if (mode === "plan") setPlanning(busy);
  else setApplying(busy);
}

function toggleSelectedModule(previous: string[], moduleName: string) {
  return previous.includes(moduleName)
    ? previous.filter((value) => value !== moduleName)
    : [...previous, moduleName];
}

function appendRunLog(setLogs: Dispatch<SetStateAction<string[]>>, line: string) {
  setLogs((previous) => [...previous, line]);
}

function toEventType(event: DeployEvent) {
  return String(event.type ?? "");
}

function toEventModules(event: DeployEvent) {
  return Array.isArray(event.modules)
    ? event.modules.map((module) => String(module))
    : [];
}

function handleRunStartEvent(
  type: string,
  event: DeployEvent,
  appendLog: (line: string) => void,
) {
  const prefix = type === "plan.start" ? "Starting plan" : "Starting deploy";
  appendLog(`${prefix}: ${toEventModules(event).join(", ")}`);
}

function handleModuleStartEvent(
  event: DeployEvent,
  appendLog: (line: string) => void,
) {
  appendLog(`\n==> Module: ${String(event.module ?? "")}`);
}

function handleModuleDoneEvent(
  event: DeployEvent,
  appendLog: (line: string) => void,
) {
  appendLog(`Module ${String(event.module ?? "")}: ${String(event.status ?? "")}`);
}

function handleRunErrorEvent(event: DeployEvent, setError: (value: string) => void) {
  setError(String(event.message ?? "Apply failed"));
}

function handleRunDoneEvent(
  event: DeployEvent,
  setRunStatus: (value: RunStatus) => void,
) {
  setRunStatus(event.status === "ok" ? "ok" : "failed");
}

function handleDeployEvent(
  event: DeployEvent,
  appendLog: (line: string) => void,
  setError: (value: string) => void,
  setRunStatus: (value: RunStatus) => void,
) {
  const type = toEventType(event);
  if (type === "deploy.start" || type === "plan.start")
    return handleRunStartEvent(type, event, appendLog);
  if (type === "module.start") return handleModuleStartEvent(event, appendLog);
  if (type === "log") return appendLog(String(event.line ?? ""));
  if (type === "module.done") return handleModuleDoneEvent(event, appendLog);
  if (type === "error") return handleRunErrorEvent(event, setError);
  if (type === "deploy.done" || type === "plan.done")
    handleRunDoneEvent(event, setRunStatus);
}

async function requestRunStream(
  projectId: string,
  mode: WorkflowMode,
  selectedModules: string[],
  intent: string,
  overridePolicy: boolean,
) {
  if (mode === "apply")
    return applyOpenTofuDeployStream(projectId, selectedModules, intent, {
      overridePolicy,
    });
  return planOpenTofuDeployStream(projectId, selectedModules, intent);
}

function assertRunStreamResponse(response: Response, mode: WorkflowMode) {
  if (response.ok && response.body) return;
  const label = mode === "apply" ? "Apply" : "Plan";
  throw new Error(`${label} request failed (${response.status})`);
}

function toConfigEventType(event: ConfigEvent) {
  return String(event.type ?? "");
}

function handleConfigEvent(
  event: ConfigEvent,
  appendLog: (line: string) => void,
  setError: (value: string) => void,
  setConfigRunStatus: (value: ConfigRunStatus) => void,
) {
  const type = toConfigEventType(event);
  if (type === "config.start") {
    appendLog(`\n=== Configuration Stage ===`);
    appendLog(`Starting configuration for modules: ${String((event.modules as string[] | undefined)?.join(", ") ?? "")}`);
    return;
  }
  if (type === "host.start") {
    appendLog(`--> Host: ${String(event.host ?? "")} (attempt ${String(event.attempt ?? 1)})`);
    return;
  }
  if (type === "task.log") {
    appendLog(String(event.line ?? ""));
    return;
  }
  if (type === "host.done") {
    appendLog(`Host ${String(event.host ?? "")}: ${String(event.status ?? "")}`);
    return;
  }
  if (type === "error") {
    setError(String(event.message ?? "Configuration failed"));
    return;
  }
  if (type === "config.done") {
    setConfigRunStatus(event.status === "ok" ? "ok" : "failed");
  }
}

async function requestConfigRunStream(
  projectId: string,
  selectedModules: string[],
  intent: string,
) {
  return runAnsibleConfigStream(projectId, selectedModules, intent);
}

function assertConfigRunResponse(response: Response) {
  if (response.ok && response.body) return;
  throw new Error(`Configuration request failed (${response.status})`);
}

function useLoadPreview(args: {
  projectId: string;
  intent: string;
  setLoadingPreview: (value: boolean) => void;
  setPreview: (value: OpenTofuPreviewResult | null) => void;
  setSelectedModules: Dispatch<SetStateAction<string[]>>;
  setError: (value: string) => void;
  setRunStatus: (value: RunStatus) => void;
  setConfigRunStatus: (value: ConfigRunStatus) => void;
  setLogs: Dispatch<SetStateAction<string[]>>;
}) {
  return useCallback(async () => {
    args.setLoadingPreview(true);
    clearRunOutput(
      args.setRunStatus,
      args.setConfigRunStatus,
      args.setError,
      args.setLogs,
    );
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
  overridePolicy: boolean;
  selectedModules: string[];
  setPlanning: (value: boolean) => void;
  setApplying: (value: boolean) => void;
  setRunStatus: (value: RunStatus) => void;
  setConfigRunStatus: (value: ConfigRunStatus) => void;
  setError: (value: string) => void;
  setLogs: Dispatch<SetStateAction<string[]>>;
}) {
  return useCallback(
    async (mode: WorkflowMode) => {
      if (args.selectedModules.length < 1)
        return args.setError("Select at least one module");
      setRunBusy(mode, true, args.setPlanning, args.setApplying);
      clearRunOutput(
        args.setRunStatus,
        args.setConfigRunStatus,
        args.setError,
        args.setLogs,
      );
      try {
        const response = await requestRunStream(
          args.projectId,
          mode,
          args.selectedModules,
          args.intent,
          args.overridePolicy,
        );
        assertRunStreamResponse(response, mode);
        for await (const rawEvent of readSseJson<DeployEvent>(response)) {
          handleDeployEvent(
            rawEvent,
            (line) => appendRunLog(args.setLogs, line),
            args.setError,
            args.setRunStatus,
          );
        }
      } catch (error: unknown) {
        args.setError(error instanceof Error ? error.message : "Run failed");
        args.setRunStatus("failed");
      } finally {
        setRunBusy(mode, false, args.setPlanning, args.setApplying);
      }
    },
    [args],
  );
}

function useLoadAnsibleStatus(
  projectId: string,
  setLoadingAnsibleStatus: (value: boolean) => void,
  setAnsibleStatus: (value: AnsibleStatus | null) => void,
  setError: (value: string) => void,
) {
  return useCallback(async () => {
    setLoadingAnsibleStatus(true);
    try {
      const data = await getAnsibleStatus(projectId);
      setAnsibleStatus(data);
    } catch (error: unknown) {
      setAnsibleStatus(null);
      setError(
        error instanceof Error ? error.message : "Failed to load Ansible status",
      );
    } finally {
      setLoadingAnsibleStatus(false);
    }
  }, [projectId, setAnsibleStatus, setError, setLoadingAnsibleStatus]);
}

function useLoadInfraGraph(
  projectId: string,
  setLoadingInfraGraph: (value: boolean) => void,
  setInfraGraph: (value: OpenTofuGraphResult | null) => void,
  setInfraGraphError: (value: string) => void,
) {
  return useCallback(async () => {
    setLoadingInfraGraph(true);
    setInfraGraphError("");
    try {
      const data = await getOpenTofuGraph(projectId, { module: "all", type: "plan" });
      setInfraGraph(data);
    } catch (error: unknown) {
      setInfraGraph(null);
      setInfraGraphError(
        error instanceof Error ? error.message : "Failed to load infrastructure graph",
      );
    } finally {
      setLoadingInfraGraph(false);
    }
  }, [projectId, setInfraGraph, setInfraGraphError, setLoadingInfraGraph]);
}

function useRunConfig(args: {
  projectId: string;
  intent: string;
  selectedModules: string[];
  ansibleStatus: AnsibleStatus | null;
  setConfiguring: (value: boolean) => void;
  setConfigRunStatus: (value: ConfigRunStatus) => void;
  setError: (value: string) => void;
  setLogs: Dispatch<SetStateAction<string[]>>;
}) {
  return useCallback(async () => {
    if (args.selectedModules.length < 1) {
      args.setError("Select at least one module");
      return;
    }
    if (!args.ansibleStatus?.can_run) {
      args.setError("Ansible runtime is not ready. Check status details.");
      return;
    }

    args.setConfiguring(true);
    args.setConfigRunStatus(null);
    args.setError("");
    appendRunLog(args.setLogs, "\n=== Starting Post-Provision Configuration ===");
    try {
      const response = await requestConfigRunStream(
        args.projectId,
        args.selectedModules,
        args.intent,
      );
      assertConfigRunResponse(response);
      for await (const rawEvent of readSseJson<ConfigEvent>(response)) {
        handleConfigEvent(
          rawEvent,
          (line) => appendRunLog(args.setLogs, line),
          args.setError,
          args.setConfigRunStatus,
        );
      }
    } catch (error: unknown) {
      args.setError(
        error instanceof Error ? error.message : "Configuration run failed",
      );
      args.setConfigRunStatus("failed");
    } finally {
      args.setConfiguring(false);
    }
  }, [args]);
}

function OpenTofuStatusAlerts({ status }: { status: OpenTofuStatus }) {
  if (!status.opentofu_available) {
    return (
      <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-100">
        <AlertTitle>OpenTofu unavailable</AlertTitle>
        <AlertDescription>
          OpenTofu CLI is not available on backend host.
        </AlertDescription>
      </Alert>
    );
  }
  if (status.credential_ready) return null;
  return (
    <Alert className="border-blue-500/40 bg-blue-500/10 text-blue-100">
      <AlertTitle>Plan available without credentials</AlertTitle>
      <AlertDescription>
        Run Plan to check changes. Add credentials to use Apply.
      </AlertDescription>
    </Alert>
  );
}

function AnsibleStatusCardShell(props: {
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <Card className="bg-[var(--da-elevated)]">
      <CardHeader>
        <CardTitle className="text-base">Configuration Stage</CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      {props.children}
    </Card>
  );
}

function AnsibleStatusDetails({ status }: { status: AnsibleStatus }) {
  return (
    <>
      <p>Playbook: <code>{status.playbook_path}</code></p>
      {status.config_summary.package_targets.length > 0 ? <p>Packages: {status.config_summary.package_targets.join(", ")}</p> : null}
      {status.config_summary.service_targets.length > 0 ? <p>Services: {status.config_summary.service_targets.join(", ")}</p> : null}
      {status.config_summary.file_targets.length > 0 ? <p>Files: {status.config_summary.file_targets.join(", ")}</p> : null}
      {status.latest_run ? (
        <p>Last run: {status.latest_run.status.toUpperCase()} ({status.latest_run.results.length} hosts, {status.latest_run.attempts} attempts)</p>
      ) : (
        <p>Last run: none yet.</p>
      )}
      {status.missing_requirements.length > 0 ? <p>Missing: {status.missing_requirements.join(", ")}</p> : null}
      {status.output_errors.length > 0 ? <p>Output issues: {status.output_errors.join(" | ")}</p> : null}
    </>
  );
}

function AnsibleStatusCard({
  status,
  loading,
  onRefresh,
}: {
  status: AnsibleStatus | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  if (loading) {
    return (
      <AnsibleStatusCardShell description="Checking Ansible runtime readiness..." />
    );
  }
  if (!status) {
    return (
      <AnsibleStatusCardShell description="Unable to load configuration readiness.">
        <CardContent>
          <Button variant="outline" onClick={onRefresh}>
            Reload Config Status
          </Button>
        </CardContent>
      </AnsibleStatusCardShell>
    );
  }
  return (
    <AnsibleStatusCardShell description={status.can_run ? `Ready to run. Hosts discovered: ${status.host_count}.` : "Ansible runtime is not ready yet."}>
      <CardContent className="space-y-2 text-sm text-[var(--da-muted)]">
        <AnsibleStatusDetails status={status} />
        <Button variant="outline" onClick={onRefresh}>
          Refresh Config Status
        </Button>
      </CardContent>
    </AnsibleStatusCardShell>
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
      <Textarea
        value={intent}
        onChange={(event) => onIntentChange(event.target.value)}
        placeholder="Optional deploy intent"
        className="min-h-24"
      />
      <Button onClick={onLoadPreview} disabled={loadingPreview || !canPreview}>
        {loadingPreview ? "Previewing..." : "Preview Targets"}
      </Button>
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
          <label
            key={moduleName}
            className="flex items-center gap-2 text-sm text-[var(--da-text)]"
          >
            <input
              type="checkbox"
              checked={selectedModules.includes(moduleName)}
              onChange={() => onToggleModule(moduleName)}
            />
            <code>{moduleName}</code>
          </label>
        ))}
        {preview.modules.length < 1 ? (
          <p className="text-sm text-[var(--da-muted)]">No modules found.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function InfrastructureSummaryCard({
  graph,
  loading,
  error,
  onRefresh,
}: {
  graph: OpenTofuGraphResult | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
}) {
  if (loading) {
    return (
      <Card className="bg-[var(--da-elevated)]">
        <CardHeader>
          <CardTitle className="text-base">Infrastructure Setup</CardTitle>
          <CardDescription>Loading infrastructure topology...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-[var(--da-elevated)]">
        <CardHeader>
          <CardTitle className="text-base">Infrastructure Setup</CardTitle>
          <CardDescription>Unable to visualize infrastructure graph.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-[var(--da-muted)]">
          <p>{error}</p>
          <Button variant="outline" onClick={onRefresh}>Reload Infra View</Button>
        </CardContent>
      </Card>
    );
  }

  const modules = graph?.graph.modules ?? [];
  const stats = graph?.graph.stats;
  const resources = (graph?.graph.nodes ?? []).filter((node) => node.kind === "resource");
  const byType = new Map<string, number>();
  for (const node of resources) {
    const key = node.resource_type || "unknown";
    byType.set(key, (byType.get(key) ?? 0) + 1);
  }
  const topTypes = Array.from(byType.entries())
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, 8);

  return (
    <Card className="bg-[var(--da-elevated)]">
      <CardHeader>
        <CardTitle className="text-base">Infrastructure Setup</CardTitle>
        <CardDescription>
          {stats
            ? `${stats.module_count} modules, ${stats.resource_count} resources, ${stats.edge_count} dependencies`
            : "No graph data yet."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-[var(--da-muted)]">
        {modules.length > 0 ? (
          <p>Modules: {modules.map((module) => module.name).join(", ")}</p>
        ) : (
          <p>Modules: none discovered yet.</p>
        )}
        {topTypes.length > 0 ? (
          <p>
            Resource types: {topTypes.map(([name, count]) => `${name} (${count})`).join(", ")}
          </p>
        ) : (
          <p>Resource types: none yet.</p>
        )}
        <Button variant="outline" onClick={onRefresh}>Refresh Infra View</Button>
      </CardContent>
    </Card>
  );
}

function DeployActionBar({
  runStatus,
  configRunStatus,
  canPlan,
  canApply,
  canRunConfig,
  planning,
  applying,
  configuring,
  onRun,
  onRunConfig,
}: {
  runStatus: RunStatus;
  configRunStatus: ConfigRunStatus;
  canPlan: boolean;
  canApply: boolean;
  canRunConfig: boolean;
  planning: boolean;
  applying: boolean;
  configuring: boolean;
  onRun: (mode: WorkflowMode) => void;
  onRunConfig: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {runStatus === "ok" ? (
        <span className="text-xs text-green-300">Infra OK</span>
      ) : null}
      {runStatus === "failed" ? (
        <span className="text-xs text-red-300">Infra failed</span>
      ) : null}
      {configRunStatus === "ok" ? (
        <span className="text-xs text-green-300">Config OK</span>
      ) : null}
      {configRunStatus === "failed" ? (
        <span className="text-xs text-red-300">Config failed</span>
      ) : null}
      <Button variant="outline" onClick={() => onRun("plan")} disabled={!canPlan}>
        {planning ? "Planning..." : "Run Plan"}
      </Button>
      <Button onClick={() => onRun("apply")} disabled={!canApply}>
        {applying ? "Applying..." : "Confirm & Apply"}
      </Button>
      <Button variant="secondary" onClick={onRunConfig} disabled={!canRunConfig}>
        {configuring ? "Configuring..." : "Confirm & Run Config"}
      </Button>
    </div>
  );
}

function PolicyOverrideOption({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-[var(--da-muted)]">
      <input
        type="checkbox"
        checked={value}
        onChange={(event) => onChange(event.target.checked)}
      />
      Override policy gate for apply (audit event still recorded)
    </label>
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
      {logs.length < 1 ? (
        <p className="text-[var(--da-muted)]">Run logs will appear here...</p>
      ) : (
        logs.map((line, index) => (
          <div key={`${index}-${line.slice(0, 12)}`}>{line}</div>
        ))
      )}
    </ScrollArea>
  );
}

function useDeployModalViewModel(
  projectId: string,
  status: OpenTofuStatus,
  state: ReturnType<typeof useDeployModalState>,
) {
  const canPreview = status.opentofu_available;
  const canPlan =
    !state.applying &&
    !state.planning &&
    !state.configuring &&
    state.selectedModules.length > 0 &&
    status.opentofu_available;
  const canApply = canPlan && status.credential_ready;
  const canRunConfig =
    state.runStatus === "ok" &&
    !state.configuring &&
    !state.planning &&
    !state.applying &&
    state.selectedModules.length > 0 &&
    Boolean(state.ansibleStatus?.can_run);

  const loadPreview = useLoadPreview({
    projectId,
    intent: state.intent,
    setLoadingPreview: state.setLoadingPreview,
    setPreview: state.setPreview,
    setSelectedModules: state.setSelectedModules,
    setError: state.setError,
    setRunStatus: state.setRunStatus,
    setConfigRunStatus: state.setConfigRunStatus,
    setLogs: state.setLogs,
  });

  const runWorkflow = useRunWorkflow({
    projectId,
    intent: state.intent,
    overridePolicy: state.overridePolicy,
    selectedModules: state.selectedModules,
    setPlanning: state.setPlanning,
    setApplying: state.setApplying,
    setRunStatus: state.setRunStatus,
    setConfigRunStatus: state.setConfigRunStatus,
    setError: state.setError,
    setLogs: state.setLogs,
  });

  const loadAnsibleStatus = useLoadAnsibleStatus(
    projectId,
    state.setLoadingAnsibleStatus,
    state.setAnsibleStatus,
    state.setError,
  );

  const runConfig = useRunConfig({
    projectId,
    intent: state.intent,
    selectedModules: state.selectedModules,
    ansibleStatus: state.ansibleStatus,
    setConfiguring: state.setConfiguring,
    setConfigRunStatus: state.setConfigRunStatus,
    setError: state.setError,
    setLogs: state.setLogs,
  });

  const loadInfraGraph = useLoadInfraGraph(
    projectId,
    state.setLoadingInfraGraph,
    state.setInfraGraph,
    state.setInfraGraphError,
  );

  return {
    canPreview,
    canPlan,
    canApply,
    canRunConfig,
    loadPreview,
    runWorkflow,
    loadAnsibleStatus,
    loadInfraGraph,
    runConfig,
  };
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
        <DialogDescription>
          Plan and apply infrastructure, then run post-provision configuration.
        </DialogDescription>
      </DialogHeader>
      <OpenTofuStatusAlerts status={status} />
      <DeployIntentInput
        intent={state.intent}
        canPreview={view.canPreview}
        loadingPreview={state.loadingPreview}
        onIntentChange={state.setIntent}
        onLoadPreview={() => void view.loadPreview()}
      />
      <PreviewModulesCard
        preview={state.preview}
        selectedModules={state.selectedModules}
        onToggleModule={(moduleName) =>
          state.setSelectedModules((previous) =>
            toggleSelectedModule(previous, moduleName),
          )
        }
      />
      <InfrastructureSummaryCard
        graph={state.infraGraph}
        loading={state.loadingInfraGraph}
        error={state.infraGraphError}
        onRefresh={() => void view.loadInfraGraph()}
      />
      <AnsibleStatusCard
        status={state.ansibleStatus}
        loading={state.loadingAnsibleStatus}
        onRefresh={() => void view.loadAnsibleStatus()}
      />
      <DeployActionBar
        runStatus={state.runStatus}
        configRunStatus={state.configRunStatus}
        canPlan={view.canPlan}
        canApply={view.canApply}
        canRunConfig={view.canRunConfig}
        planning={state.planning}
        applying={state.applying}
        configuring={state.configuring}
        onRun={(mode) => void view.runWorkflow(mode)}
        onRunConfig={() => void view.runConfig()}
      />
      <PolicyOverrideOption
        value={state.overridePolicy}
        onChange={state.setOverridePolicy}
      />
      <DeployErrorAlert error={state.error} />
      <DeployLogsPanel logs={state.logs} />
    </DialogContent>
  );
}

export function OpenTofuDeployModal({
  projectId,
  status,
  onClose,
}: OpenTofuDeployModalProps) {
  const state = useDeployModalState();
  const view = useDeployModalViewModel(projectId, status, state);

  useEffect(() => {
    void view.loadAnsibleStatus();
  }, [view.loadAnsibleStatus]);

  useEffect(() => {
    void view.loadInfraGraph();
  }, [view.loadInfraGraph]);

  useEffect(() => {
    if (state.runStatus === "ok") void view.loadAnsibleStatus();
  }, [state.runStatus, view.loadAnsibleStatus]);

  useEffect(() => {
    if (state.runStatus === "ok") void view.loadInfraGraph();
  }, [state.runStatus, view.loadInfraGraph]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <OpenTofuDeployDialogContent status={status} state={state} view={view} />
    </Dialog>
  );
}
