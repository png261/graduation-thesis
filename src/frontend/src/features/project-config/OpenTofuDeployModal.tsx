import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

import {
  applyOpenTofuDeployStream,
  destroyOpenTofuDeployStream,
  enqueueProjectJob,
  getAnsibleStatus,
  getOpenTofuDeployPreflight,
  getOpenTofuGraph,
  getProjectRunHistory,
  planOpenTofuDeployStream,
  previewOpenTofuDeploy,
  rerunPostDeployChecks,
  streamProjectJobEvents,
  validateOpenTofuTargetContract,
  type AnsibleStatus,
  type OpenTofuDeployChecklistItem,
  type OpenTofuDeployPreflight,
  type OpenTofuGraphResult,
  type OpenTofuPreviewResult,
  type OpenTofuStatus,
  type ProjectPostDeployHost,
  type ProjectPostDeploySummary,
  type ProjectRunHistoryItem,
  type ProjectSsmReadiness,
  type ProjectTerraformTargetContract,
} from "../../api/projects";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Textarea } from "../../components/ui/textarea";
import { readSseJson } from "../../lib/sse";
import { getAnsibleExecutionState } from "./ansibleExecutionState";
import {
  buildDestroyConfirmationExpectation,
  buildPartialScopeWarning,
  canEnablePartialApply,
  createReviewSessionId,
  formatPostDeployBadge,
  formatPostDeploySummary,
  mapDeployGateError,
  resolveScopeMode,
} from "./deployExecutionState";
import { TerraformTargetHandoffPanel } from "./sections/DeploySection";

type RunState = "ok" | "failed" | null;
type DeployEvent = Record<string, unknown>;

const SAVED_CREDENTIALS_GUIDANCE =
  "Saved AWS credentials are incomplete. Finish the Credentials section before apply or destroy.";
const GENERATION_GUIDANCE = "Generate Terraform and Ansible artifacts before continuing.";
const PLAN_REVIEW_GUIDANCE = "Review the latest plan in this session before continuing.";
const DESTROY_REVIEW_GUIDANCE = "Run and review a destroy plan in this session before continuing.";
const DRIFT_REFRESH_GUIDANCE = "Refresh drift on the primary state backend before continuing.";
const DRIFT_OVERRIDE_GUIDANCE =
  "Refresh drift on the primary state backend before continuing, or explicitly allow partial apply for the selected scope.";
const PARTIAL_SCOPE_GUIDANCE = "Acknowledge the advanced partial-scope warning before continuing.";
const DESTROY_CONFIRMATION_GUIDANCE = "Type the project name and destroy before starting destroy.";
const PARTIAL_APPLY_WARNING =
  "Partial apply is an advanced escape hatch and may leave drift outside the selected scope.";
const PARTIAL_DESTROY_WARNING =
  "Partial destroy is an advanced escape hatch and may leave dependent resources behind.";
const PARTIAL_DRIFT_OVERRIDE_COPY =
  "Allow partial apply despite active drift outside the selected scope.";
const DESTROY_HELPER_COPY = "Type the project name and destroy to enable full destroy.";

interface OpenTofuDeployModalProps {
  projectId: string;
  projectName: string;
  status: OpenTofuStatus;
  onClose: () => void;
}

function appendLog(setLogs: Dispatch<SetStateAction<string[]>>, line: string) {
  setLogs((previous) => [...previous, line]);
}

function toggleSelectedModule(previous: string[], moduleName: string) {
  return previous.includes(moduleName)
    ? previous.filter((value) => value !== moduleName)
    : [...previous, moduleName];
}

function toStringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
}

function handleDeployEvent(args: {
  event: DeployEvent;
  setError: (value: string) => void;
  setInfraStatus: (value: RunState) => void;
  setConfigStatus: (value: RunState) => void;
  setDestroyStatus: (value: RunState) => void;
  setLogs: Dispatch<SetStateAction<string[]>>;
}) {
  const type = toStringValue(args.event.type);
  if (type === "deploy.start" || type === "plan.start" || type === "pipeline.start" || type === "destroy.start") {
    const label =
      type === "plan.start"
        ? "Starting plan"
        : type === "pipeline.start"
          ? "Starting ordered deploy"
          : type === "destroy.start"
            ? "Starting destroy"
            : "Starting apply";
    const modules = toStringArray(args.event.modules).join(", ") || toStringArray(args.event.selected_modules).join(", ");
    appendLog(args.setLogs, modules ? `${label}: ${modules}` : label);
    return;
  }
  if (type === "module.start") {
    appendLog(args.setLogs, `==> Module: ${toStringValue(args.event.module)}`);
    return;
  }
  if (type === "log" || type === "task.log") {
    appendLog(args.setLogs, toStringValue(args.event.line));
    return;
  }
  if (type === "host.start") {
    appendLog(args.setLogs, `--> Host: ${toStringValue(args.event.host)} (attempt ${toStringValue(args.event.attempt, "1")})`);
    return;
  }
  if (type === "host.done") {
    appendLog(args.setLogs, `Host ${toStringValue(args.event.host)}: ${toStringValue(args.event.status)}`);
    return;
  }
  if (type === "config.start") {
    appendLog(args.setLogs, "=== Configuration Stage ===");
    const modules = toStringArray(args.event.modules);
    if (modules.length > 0) appendLog(args.setLogs, `Starting configuration for modules: ${modules.join(", ")}`);
    return;
  }
  if (type === "ssm_readiness.start" || type === "ssm_readiness.progress" || type === "ssm_readiness.done") {
    const ready = Number(args.event.ready_target_count ?? 0);
    const total = Number(args.event.target_count ?? 0);
    const label =
      type === "ssm_readiness.start"
        ? "=== SSM Readiness Stage ==="
        : type === "ssm_readiness.done"
          ? "SSM readiness complete"
          : "SSM readiness progress";
    appendLog(args.setLogs, total > 0 ? `${label}: ${ready}/${total} ready` : label);
    return;
  }
  if (type === "module.done") {
    appendLog(args.setLogs, `Module ${toStringValue(args.event.module)}: ${toStringValue(args.event.status)}`);
    return;
  }
  if (type === "error") {
    const code = toStringValue(args.event.code);
    const fallback = toStringValue(args.event.message, "Run failed");
    args.setError(mapDeployGateError(code, fallback));
    return;
  }
  if (type === "deploy.done") {
    args.setInfraStatus(args.event.status === "ok" ? "ok" : "failed");
    return;
  }
  if (type === "destroy.done") {
    args.setDestroyStatus(args.event.status === "ok" ? "ok" : "failed");
    return;
  }
  if (type === "config.done") {
    args.setConfigStatus(args.event.status === "ok" ? "ok" : "failed");
    return;
  }
  if (type === "pipeline.done") {
    const ok = args.event.status === "ok";
    args.setInfraStatus(ok ? "ok" : "failed");
    args.setConfigStatus(ok ? "ok" : "failed");
    appendLog(args.setLogs, ok ? "Ordered deploy completed." : "Ordered deploy failed.");
  }
}

function StatusAlert({ status }: { status: OpenTofuStatus }) {
  if (!status.opentofu_available) {
    return (
      <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-100">
        <AlertTitle>OpenTofu unavailable</AlertTitle>
        <AlertDescription>OpenTofu CLI is not available on the backend host.</AlertDescription>
      </Alert>
    );
  }
  if (status.credential_ready) return null;
  return (
    <Alert className="border-blue-500/40 bg-blue-500/10 text-blue-100">
      <AlertTitle>Plan available without credentials</AlertTitle>
      <AlertDescription>Run plan to review changes. Add saved AWS credentials before apply or destroy.</AlertDescription>
    </Alert>
  );
}

function DeployChecklist({ checklist }: { checklist: OpenTofuDeployChecklistItem[] }) {
  if (checklist.length < 1) {
    return <p className="rounded border border-white/10 bg-black/20 p-3 text-xs text-[var(--da-muted)]">Loading deploy readiness...</p>;
  }
  return (
    <div className="space-y-2">
      {checklist.map((item) => (
        <div key={item.name} className="rounded border border-white/10 bg-black/20 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-white">{item.name}</p>
            <span className={`rounded border border-white/10 px-2 py-0.5 text-[11px] uppercase ${item.ready ? "text-emerald-300" : "text-amber-300"}`}>
              {item.ready ? "Ready" : "Blocked"}
            </span>
          </div>
          <p className="mt-2 text-xs text-[var(--da-muted)]">{item.message}</p>
        </div>
      ))}
    </div>
  );
}

function SsmReadinessSection({
  readiness,
}: {
  readiness: ProjectSsmReadiness | null | undefined;
}) {
  const targets = readiness?.targets ?? [];
  const failedTargets = readiness?.failed_targets ?? [];
  return (
    <SectionCard
      title="SSM Readiness"
      description="Track the current scope as AWS Systems Manager validates each expected target."
    >
      <div className="rounded border border-white/10 bg-black/20 p-3 text-xs text-[var(--da-muted)]">
        <p><span className="font-semibold text-white">Status</span>: {readiness?.status || "unavailable"}</p>
        <p><span className="font-semibold text-white">Targets ready</span>: {readiness?.ready_target_count ?? 0}</p>
        <p><span className="font-semibold text-white">Targets pending</span>: {readiness?.pending_target_count ?? 0}</p>
        <p><span className="font-semibold text-white">Targets failed</span>: {readiness?.failed_target_count ?? 0}</p>
        <p><span className="font-semibold text-white">Last checked</span>: {readiness?.checked_at || "-"}</p>
      </div>
      {readiness?.status === "ready" ? (
        <p className="text-sm text-emerald-200">All scoped targets are SSM-ready.</p>
      ) : null}
      {readiness?.status === "no_targets" ? (
        <p className="text-sm text-amber-200">No Terraform targets were resolved for the current scope.</p>
      ) : null}
      {readiness?.blocker_message ? (
        <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-100">
          <AlertTitle>Readiness blocker</AlertTitle>
          <AlertDescription>{readiness.blocker_message}</AlertDescription>
        </Alert>
      ) : null}
      {failedTargets.length > 0 ? (
        <div className="space-y-2 rounded border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-100">
          <p className="text-sm font-semibold text-white">Failed targets</p>
          {failedTargets.map((target) => (
            <p key={`failed-${target.execution_id}`}><code>{target.execution_id}</code></p>
          ))}
        </div>
      ) : null}
      {targets.length > 0 ? (
        <div className="space-y-2">
          {targets.map((target) => (
            <div key={target.execution_id} className="rounded border border-white/10 bg-black/20 p-3 text-xs text-[var(--da-muted)]">
              <p className="text-sm font-semibold text-white">{target.display_name || target.execution_id}</p>
              <p><span className="font-semibold text-white">Execution ID</span>: {target.execution_id}</p>
              <p><span className="font-semibold text-white">Role</span>: {target.role}</p>
              <p><span className="font-semibold text-white">Registration</span>: {target.registration_status}</p>
              <p><span className="font-semibold text-white">Ping</span>: {target.ping_status}</p>
              <p><span className="font-semibold text-white">Platform</span>: {target.platform_status}</p>
              <p><span className="font-semibold text-white">Last check-in</span>: {target.last_seen_at || "-"}</p>
              <p><span className="font-semibold text-white">Blocking reason</span>: {target.blocking_reason || "-"}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-[var(--da-muted)]">No SSM readiness targets available yet.</p>
      )}
    </SectionCard>
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
  const stats = graph?.graph.stats;
  const modules = graph?.graph.modules ?? [];
  return (
    <Card className="bg-[var(--da-elevated)]">
      <CardHeader>
        <CardTitle className="text-base">Infrastructure Setup</CardTitle>
        <CardDescription>
          {loading
            ? "Loading infrastructure topology..."
            : error
              ? "Unable to load infrastructure topology."
              : stats
                ? `${stats.module_count} modules, ${stats.resource_count} resources, ${stats.edge_count} dependencies`
                : "No graph data yet."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-[var(--da-muted)]">
        {error ? <p>{error}</p> : <p>Modules: {modules.length > 0 ? modules.map((module) => module.name).join(", ") : "none discovered yet."}</p>}
        <Button variant="outline" onClick={onRefresh}>Refresh Infra View</Button>
      </CardContent>
    </Card>
  );
}

function AnsibleStatusCard({
  status,
  opentofuStatus,
  loading,
  error,
  onRefresh,
}: {
  status: AnsibleStatus | null;
  opentofuStatus: OpenTofuStatus;
  loading: boolean;
  error: string;
  onRefresh: () => void;
}) {
  const execution = getAnsibleExecutionState(opentofuStatus, status);
  return (
    <Card className="bg-[var(--da-elevated)]">
      <CardHeader>
        <CardTitle className="text-base">Configuration Stage</CardTitle>
        <CardDescription>
          {loading ? "Checking Ansible runtime readiness..." : execution.readinessCopy}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-[var(--da-muted)]">
        {error ? <p>{error}</p> : <p>{execution.stageSummary}</p>}
        {status ? (
          <>
            <p>Playbook: <code>{status.playbook_path}</code></p>
            <p>Generated targets: {status.targetModules.length > 0 ? status.targetModules.join(", ") : "none"}</p>
            {status.latest_run ? <LatestRunProvenance latestRun={status.latest_run} /> : null}
          </>
        ) : null}
        {execution.blockedReason ? (
          <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-100">
            <AlertTitle>Configuration blocked</AlertTitle>
            <AlertDescription>{execution.blockedReason}</AlertDescription>
          </Alert>
        ) : null}
        <Button variant="outline" onClick={onRefresh}>Refresh Config Status</Button>
      </CardContent>
    </Card>
  );
}

function latestRunTransportLabel(latestRun: NonNullable<AnsibleStatus["latest_run"]>) {
  if (latestRun.transport?.mode === "ssm") return "AWS Systems Manager";
  return latestRun.transport?.mode ? latestRun.transport.mode.toUpperCase() : "Unknown transport";
}

function LatestRunProvenance({
  latestRun,
}: {
  latestRun: NonNullable<AnsibleStatus["latest_run"]>;
}) {
  const modules = latestRun.selected_modules.length > 0 ? latestRun.selected_modules : latestRun.modules;
  const targetCount = latestRun.target_count || latestRun.transport?.target_count || latestRun.host_count;
  const targetIds = latestRun.target_ids.length > 0 ? latestRun.target_ids : latestRun.transport?.target_ids || [];

  return (
    <div className="rounded border border-white/10 bg-black/20 p-3 text-xs text-[var(--da-muted)]">
      <p><span className="font-semibold text-white">Latest run</span>: {latestRun.status === "ok" ? "Succeeded" : "Failed"} via {latestRunTransportLabel(latestRun)}</p>
      <p><span className="font-semibold text-white">Scoped modules</span>: {modules.length > 0 ? modules.join(", ") : "full configuration scope"}</p>
      <p><span className="font-semibold text-white">Scoped targets</span>: {targetCount}</p>
      <p><span className="font-semibold text-white">Target IDs</span>: {targetIds.length > 0 ? targetIds.join(", ") : "None recorded"}</p>
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
  const modules = preview?.modules ?? [];
  return (
    <Card className="bg-[var(--da-elevated)]">
      <CardHeader>
        <CardTitle className="text-base">Module Scope</CardTitle>
        <CardDescription>{preview?.reason || "Preview target modules to choose a partial scope."}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {modules.map((moduleName) => (
          <label key={moduleName} className="flex items-center gap-2 text-sm text-[var(--da-text)]">
            <input
              type="checkbox"
              checked={selectedModules.includes(moduleName)}
              onChange={() => onToggleModule(moduleName)}
            />
            <code>{moduleName}</code>
          </label>
        ))}
        {modules.length < 1 ? <p className="text-sm text-[var(--da-muted)]">No preview modules available yet.</p> : null}
      </CardContent>
    </Card>
  );
}

function ScopeSelector({
  partialScopeSelected,
  setPartialScopeSelected,
  hasPreviewModules,
}: {
  partialScopeSelected: boolean;
  setPartialScopeSelected: (value: boolean) => void;
  hasPreviewModules: boolean;
}) {
  return (
    <Card className="bg-[var(--da-elevated)]">
      <CardHeader>
        <CardTitle className="text-base">Execution Scope</CardTitle>
        <CardDescription>Use full scope by default. Partial scope is an explicit advanced path.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-[var(--da-muted)]">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={!partialScopeSelected}
            onChange={() => setPartialScopeSelected(false)}
          />
          Full scope
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={partialScopeSelected}
            onChange={() => setPartialScopeSelected(true)}
            disabled={!hasPreviewModules}
          />
          Selected modules only
        </label>
      </CardContent>
    </Card>
  );
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card className="bg-[var(--da-elevated)]">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

function StatusPills({
  infraStatus,
  configStatus,
  destroyStatus,
}: {
  infraStatus: RunState;
  configStatus: RunState;
  destroyStatus: RunState;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {infraStatus === "ok" ? <span className="text-green-300">Infra OK</span> : null}
      {infraStatus === "failed" ? <span className="text-red-300">Infra failed</span> : null}
      {configStatus === "ok" ? <span className="text-green-300">Config OK</span> : null}
      {configStatus === "failed" ? <span className="text-red-300">Config failed</span> : null}
      {destroyStatus === "ok" ? <span className="text-green-300">Destroy OK</span> : null}
      {destroyStatus === "failed" ? <span className="text-red-300">Destroy failed</span> : null}
    </div>
  );
}

function latestPostDeployRun(items: ProjectRunHistoryItem[]): ProjectRunHistoryItem | null {
  return (
    items.find((item) => Boolean(item.post_deploy_summary) && Boolean(item.stage_summary?.post_deploy))
    ?? items.find((item) => Boolean(item.post_deploy_summary))
    ?? items.find((item) => Boolean(item.stage_summary?.post_deploy))
    ?? null
  );
}

function PostDeploySectionDetails({
  title,
  section,
}: {
  title: string;
  section: {
    items?: Array<Record<string, unknown>>;
    truncated?: boolean;
    redacted?: boolean;
  } | null | undefined;
}) {
  if (!section) return null;
  const badges = formatPostDeployBadge({
    items: section.items ?? [],
    truncated: section.truncated,
    redacted: section.redacted,
  });
  return (
    <div className="rounded border border-white/10 bg-black/20 p-3">
      <div className="mb-2 flex items-center gap-2">
        <p className="text-sm font-semibold text-white">{title}</p>
        {badges.map((badge) => (
          <span key={`${title}-${badge}`} className="rounded border border-white/10 px-2 py-0.5 text-[10px] uppercase text-amber-200">
            {badge}
          </span>
        ))}
      </div>
      <div className="space-y-2 text-xs text-[var(--da-muted)]">
        {(section.items ?? []).map((item, index) => (
          <pre key={`${title}-${index}`} className="overflow-x-auto whitespace-pre-wrap rounded bg-black/20 p-2 text-[11px] text-blue-100/85">
            {JSON.stringify(item, null, 2)}
          </pre>
        ))}
        {(section.items ?? []).length < 1 ? <p>No data collected.</p> : null}
      </div>
    </div>
  );
}

function PostDeployLoggingCard({
  summary,
  hosts,
  disabled,
  busy,
  onRerun,
}: {
  summary: ProjectPostDeploySummary | null;
  hosts: ProjectPostDeployHost[];
  disabled: boolean;
  busy: boolean;
  onRerun: () => void;
}) {
  if (!summary) return null;
  return (
    <SectionCard
      title="Post-Deploy Logging"
      description="Inspect collected host diagnostics, health checks, and targeted runtime logs from the latest completed run."
    >
      <div className="rounded border border-white/10 bg-black/20 p-3 text-xs text-[var(--da-muted)]">
        <p><span className="font-semibold text-white">Collected hosts</span>: {summary.host_count}</p>
        <p><span className="font-semibold text-white">Skipped hosts</span>: {summary.skipped_host_count}</p>
        <p><span className="font-semibold text-white">Health summary</span>: {summary.health_summary}</p>
        <p className="mt-2">{formatPostDeploySummary(summary)}</p>
      </div>
      <Button variant="outline" onClick={onRerun} disabled={disabled || busy}>
        {busy ? "Rerunning..." : "Rerun Post-Deploy Checks"}
      </Button>
      {hosts.map((host) => (
        <details key={host.host.name} className="rounded border border-white/10 bg-black/20 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-white">
            {host.host.name} {host.ready ? "· ready" : "· needs attention"}
          </summary>
          <div className="mt-3 space-y-3">
            <PostDeploySectionDetails title="System Info" section={host.system} />
            <PostDeploySectionDetails title="Services" section={host.services} />
            <PostDeploySectionDetails title="Packages" section={host.packages} />
            <PostDeploySectionDetails title="Health Checks" section={host.health_checks} />
            <PostDeploySectionDetails title="Service Logs" section={host.service_logs} />
          </div>
        </details>
      ))}
    </SectionCard>
  );
}

function DestroyConfirmationFields({
  projectName,
  destroyProjectName,
  destroyKeyword,
  onProjectNameChange,
  onKeywordChange,
  selectedModules,
}: {
  projectName: string;
  destroyProjectName: string;
  destroyKeyword: string;
  onProjectNameChange: (value: string) => void;
  onKeywordChange: (value: string) => void;
  selectedModules: string[];
}) {
  const expectation = buildDestroyConfirmationExpectation(projectName, selectedModules);
  return (
    <div className="space-y-2">
      <p className="text-xs text-[var(--da-muted)]">{expectation.helperText}</p>
      {selectedModules.length > 0 ? (
        <p className="text-xs text-[var(--da-muted)]">Partial destroy scope: {expectation.selectedModulesLabel}</p>
      ) : null}
      <div className="grid gap-2 md:grid-cols-2">
        <Input value={destroyProjectName} onChange={(event) => onProjectNameChange(event.target.value)} placeholder={projectName} />
        <Input value={destroyKeyword} onChange={(event) => onKeywordChange(event.target.value)} placeholder="destroy" />
      </div>
    </div>
  );
}

export function OpenTofuDeployModal({
  projectId,
  projectName,
  status,
  onClose,
}: OpenTofuDeployModalProps) {
  const [reviewSessionId] = useState(() => createReviewSessionId());
  const [intent, setIntent] = useState("");
  const [preview, setPreview] = useState<OpenTofuPreviewResult | null>(null);
  const [selectedModules, setSelectedModules] = useState<string[]>(status.modules);
  const [partialScopeSelected, setPartialScopeSelected] = useState(false);
  const [partialScopeConfirmed, setPartialScopeConfirmed] = useState(false);
  const [partialDriftOverrideConfirmed, setPartialDriftOverrideConfirmed] = useState(false);
  const [overridePolicy, setOverridePolicy] = useState(false);
  const [applyPreflight, setApplyPreflight] = useState<OpenTofuDeployPreflight | null>(null);
  const [destroyPreflight, setDestroyPreflight] = useState<OpenTofuDeployPreflight | null>(null);
  const [preflightError, setPreflightError] = useState("");
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [targetContractRefreshBusy, setTargetContractRefreshBusy] = useState(false);
  const [targetContractRefreshError, setTargetContractRefreshError] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [ansibleStatus, setAnsibleStatus] = useState<AnsibleStatus | null>(null);
  const [ansibleLoading, setAnsibleLoading] = useState(false);
  const [ansibleError, setAnsibleError] = useState("");
  const [infraGraph, setInfraGraph] = useState<OpenTofuGraphResult | null>(null);
  const [infraGraphLoading, setInfraGraphLoading] = useState(false);
  const [infraGraphError, setInfraGraphError] = useState("");
  const [planningTarget, setPlanningTarget] = useState<"apply" | "destroy" | null>(null);
  const [busyMode, setBusyMode] = useState<"apply" | "pipeline" | "config" | "destroy" | null>(null);
  const [pipelineReadyForConfirmation, setPipelineReadyForConfirmation] = useState(false);
  const [destroyProjectName, setDestroyProjectName] = useState("");
  const [destroyKeyword, setDestroyKeyword] = useState("");
  const [infraStatus, setInfraStatus] = useState<RunState>(null);
  const [configStatus, setConfigStatus] = useState<RunState>(null);
  const [destroyStatus, setDestroyStatus] = useState<RunState>(null);
  const [error, setError] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [latestRun, setLatestRun] = useState<ProjectRunHistoryItem | null>(null);
  const [postDeploySummary, setPostDeploySummary] = useState<ProjectPostDeploySummary | null>(null);
  const [postDeployHosts, setPostDeployHosts] = useState<ProjectPostDeployHost[]>([]);
  const [postDeployRerunBusy, setPostDeployRerunBusy] = useState(false);

  const executionState = getAnsibleExecutionState(status, ansibleStatus);
  const scopeMode = resolveScopeMode(partialScopeSelected, selectedModules);
  const scopedSelectedModules = scopeMode === "partial" ? selectedModules : [];
  const scopedSelectionKey = scopedSelectedModules.join(",");
  const hasScopedSelection = scopeMode === "full" || scopedSelectedModules.length > 0;
  const configTargetModules = scopeMode === "partial" ? scopedSelectedModules : (ansibleStatus?.targetModules ?? []);
  const configReadinessBlocking = Boolean(applyPreflight?.ssm_readiness.blocking);
  const applyDriftStatus = applyPreflight?.drift_refresh.status ?? "";
  const canPartialApplyProceed = canEnablePartialApply({
    scopeMode,
    driftStatus: applyDriftStatus,
    partialScopeConfirmed,
    partialDriftOverrideConfirmed,
  });
  const targetContract: ProjectTerraformTargetContract | null =
    applyPreflight?.target_contract ?? destroyPreflight?.target_contract ?? null;

  useEffect(() => {
    setPipelineReadyForConfirmation(false);
  }, [intent, scopeMode, scopedSelectionKey]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    async function loadPreflight() {
      const nextSelectedModules = scopeMode === "partial" ? selectedModules : [];
      setPreflightLoading(true);
      setPreflightError("");
      try {
        const [applyData, destroyData] = await Promise.all([
          getOpenTofuDeployPreflight(projectId, {
            signal: controller.signal,
            reviewSessionId,
            reviewTarget: "apply",
            selectedModules: nextSelectedModules,
            scopeMode,
          }),
          getOpenTofuDeployPreflight(projectId, {
            signal: controller.signal,
            reviewSessionId,
            reviewTarget: "destroy",
            selectedModules: nextSelectedModules,
            scopeMode,
          }),
        ]);
        if (cancelled) return;
        setApplyPreflight(applyData);
        setDestroyPreflight(destroyData);
      } catch (nextError: unknown) {
        if (cancelled) return;
        setApplyPreflight(null);
        setDestroyPreflight(null);
        setPreflightError(nextError instanceof Error ? nextError.message : "Failed to load deploy readiness.");
      } finally {
        if (!cancelled) setPreflightLoading(false);
      }
    }
    void loadPreflight();
    const timer = setInterval(() => {
      void refreshPreflight();
    }, 10000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      controller.abort();
    };
  }, [projectId, reviewSessionId, scopeMode, scopedSelectionKey, selectedModules]);

  useEffect(() => {
    let cancelled = false;
    async function loadAnsible() {
      setAnsibleLoading(true);
      setAnsibleError("");
      try {
        const nextStatus = await getAnsibleStatus(projectId);
        if (!cancelled) setAnsibleStatus(nextStatus);
      } catch (nextError: unknown) {
        if (cancelled) return;
        setAnsibleStatus(null);
        setAnsibleError(nextError instanceof Error ? nextError.message : "Failed to load Ansible status.");
      } finally {
        if (!cancelled) setAnsibleLoading(false);
      }
    }
    void loadAnsible();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    async function loadGraph() {
      setInfraGraphLoading(true);
      setInfraGraphError("");
      try {
        const nextGraph = await getOpenTofuGraph(projectId, { module: "all", type: "plan" });
        if (!cancelled) setInfraGraph(nextGraph);
      } catch (nextError: unknown) {
        if (cancelled) return;
        setInfraGraph(null);
        setInfraGraphError(nextError instanceof Error ? nextError.message : "Failed to load infrastructure graph.");
      } finally {
        if (!cancelled) setInfraGraphLoading(false);
      }
    }
    void loadGraph();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    async function loadHistory() {
      try {
        const history = await getProjectRunHistory(projectId, { limit: 20, offset: 0 });
        if (cancelled) return;
        const latest = latestPostDeployRun(history.items);
        setLatestRun(latest);
        setPostDeploySummary(latest?.post_deploy_summary ?? null);
        setPostDeployHosts(latest?.post_deploy_hosts ?? []);
      } catch {
        if (cancelled) return;
        setLatestRun(null);
        setPostDeploySummary(null);
        setPostDeployHosts([]);
      }
    }
    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function refreshPreflight() {
    const [applyData, destroyData] = await Promise.all([
      getOpenTofuDeployPreflight(projectId, {
        reviewSessionId,
        reviewTarget: "apply",
        selectedModules: scopedSelectedModules,
        scopeMode,
      }),
      getOpenTofuDeployPreflight(projectId, {
        reviewSessionId,
        reviewTarget: "destroy",
        selectedModules: scopedSelectedModules,
        scopeMode,
      }),
    ]);
    setApplyPreflight(applyData);
    setDestroyPreflight(destroyData);
  }

  async function refreshTargetContractPreview() {
    setTargetContractRefreshBusy(true);
    setTargetContractRefreshError("");
    try {
      await validateOpenTofuTargetContract(projectId);
      await refreshPreflight();
    } catch (nextError: unknown) {
      setTargetContractRefreshError(
        nextError instanceof Error ? nextError.message : "Failed to refresh Terraform target preview.",
      );
    } finally {
      setTargetContractRefreshBusy(false);
    }
  }

  async function refreshStatusPanels() {
    try {
      const [nextAnsible, nextGraph] = await Promise.all([
        getAnsibleStatus(projectId),
        getOpenTofuGraph(projectId, { module: "all", type: "plan" }),
      ]);
      setAnsibleStatus(nextAnsible);
      setInfraGraph(nextGraph);
    } catch {
      return;
    }
  }

  async function refreshHistory() {
    try {
      const history = await getProjectRunHistory(projectId, { limit: 20, offset: 0 });
      const latest = latestPostDeployRun(history.items);
      setLatestRun(latest);
      setPostDeploySummary(latest?.post_deploy_summary ?? null);
      setPostDeployHosts(latest?.post_deploy_hosts ?? []);
    } catch {
      return;
    }
  }

  async function loadPreview() {
    setLoadingPreview(true);
    setError("");
    try {
      const data = await previewOpenTofuDeploy(projectId, intent);
      setPreview(data);
      if (data.selected_modules && data.selected_modules.length > 0) {
        setSelectedModules(data.selected_modules);
      }
      if (data.status !== "ok") {
        setError(data.message ?? "Preview failed.");
      }
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : "Preview failed.");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function consumeStream(response: Response) {
    if (!response.ok || !response.body) {
      throw new Error(`Request failed (${response.status})`);
    }
    const result = {
      plan: null as RunState,
      deploy: null as RunState,
      destroy: null as RunState,
      config: null as RunState,
      pipeline: null as RunState,
    };
    for await (const rawEvent of readSseJson<DeployEvent>(response)) {
      handleDeployEvent({
        event: rawEvent,
        setError,
        setInfraStatus,
        setConfigStatus,
        setDestroyStatus,
        setLogs,
      });
      const type = toStringValue(rawEvent.type);
      if (type === "plan.done") result.plan = rawEvent.status === "ok" ? "ok" : "failed";
      if (type === "deploy.done") result.deploy = rawEvent.status === "ok" ? "ok" : "failed";
      if (type === "destroy.done") result.destroy = rawEvent.status === "ok" ? "ok" : "failed";
      if (type === "config.done") result.config = rawEvent.status === "ok" ? "ok" : "failed";
      if (type === "pipeline.done") result.pipeline = rawEvent.status === "ok" ? "ok" : "failed";
      if (type === "post_deploy.done") {
        setPostDeploySummary({
          status: toStringValue(rawEvent.status, "failed"),
          host_count: Array.isArray(rawEvent.hosts) ? rawEvent.hosts.length : 0,
          skipped_host_count: Array.isArray(rawEvent.skipped_hosts) ? rawEvent.skipped_hosts.length : 0,
          service_count:
            typeof rawEvent.summary === "object" && rawEvent.summary !== null && typeof (rawEvent.summary as Record<string, unknown>).service_count === "number"
              ? ((rawEvent.summary as Record<string, unknown>).service_count as number)
              : 0,
          health_summary:
            typeof rawEvent.summary === "object" && rawEvent.summary !== null && typeof (rawEvent.summary as Record<string, unknown>).health_summary === "string"
              ? ((rawEvent.summary as Record<string, unknown>).health_summary as string)
              : "No health checks collected.",
          collected_at: toStringValue(rawEvent.collected_at),
        });
        setPostDeployHosts(Array.isArray(rawEvent.hosts) ? (rawEvent.hosts as ProjectPostDeployHost[]) : []);
      }
    }
    return result;
  }

  async function runPlan(reviewTarget: "apply" | "destroy", afterSuccess?: "pipeline") {
    if (!hasScopedSelection) {
      setError("Select at least one module for partial scope before planning.");
      return;
    }
    setPlanningTarget(reviewTarget);
    setError("");
    setInfraStatus(null);
    setDestroyStatus(null);
    try {
      const response = await planOpenTofuDeployStream(projectId, {
        selected_modules: scopedSelectedModules,
        intent: intent || null,
        review_session_id: reviewSessionId,
        review_target: reviewTarget,
        scope_mode: scopeMode,
        options: {},
      });
      const result = await consumeStream(response);
      await refreshPreflight();
      if (result.plan !== "ok") {
        throw new Error("Plan failed.");
      }
      if (afterSuccess === "pipeline") {
        setPipelineReadyForConfirmation(true);
      }
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : "Plan failed.");
      setInfraStatus("failed");
    } finally {
      setPlanningTarget(null);
    }
  }

  async function runApply() {
    if (!applyPreflight) {
      setError("Deploy readiness is still loading.");
      return;
    }
    if (!hasScopedSelection) {
      setError("Select at least one module for partial scope before applying.");
      return;
    }
    if (!canPartialApplyProceed) {
      setError(
        applyDriftStatus === "drift_detected" ? DRIFT_OVERRIDE_GUIDANCE : PARTIAL_SCOPE_GUIDANCE,
      );
      return;
    }
    setBusyMode("apply");
    setError("");
    setInfraStatus(null);
    try {
      const response = await applyOpenTofuDeployStream(projectId, {
        selected_modules: scopedSelectedModules,
        intent: intent || null,
        review_session_id: reviewSessionId,
        review_target: "apply",
        scope_mode: scopeMode,
        options: {
          override_policy: overridePolicy,
          confirm_partial_scope: scopeMode === "partial" ? partialScopeConfirmed : false,
          confirm_partial_drift_override:
            scopeMode === "partial" ? partialDriftOverrideConfirmed : false,
        },
      });
      await consumeStream(response);
      await refreshPreflight();
      await refreshStatusPanels();
      await refreshHistory();
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : "Apply failed.");
      setInfraStatus("failed");
    } finally {
      setBusyMode(null);
    }
  }

  async function runPipeline() {
    if (scopeMode === "partial") {
      setError(PARTIAL_SCOPE_GUIDANCE);
      return;
    }
    if (!applyPreflight) {
      setError("Deploy readiness is still loading.");
      return;
    }
    if (!executionState.canRunPipeline) {
      setError(executionState.blockedReason || GENERATION_GUIDANCE);
      return;
    }
    if (applyPreflight.review_gate.status !== "fresh" && !pipelineReadyForConfirmation) {
      await runPlan("apply", "pipeline");
      return;
    }
    setBusyMode("pipeline");
    setPipelineReadyForConfirmation(false);
    setError("");
    try {
      const job = await enqueueProjectJob(projectId, {
        kind: "pipeline",
        selected_modules: [],
        intent: intent || null,
        review_session_id: reviewSessionId,
        review_target: "apply",
        scope_mode: "full",
        options: { override_policy: overridePolicy },
      });
      const response = await streamProjectJobEvents(projectId, job.id);
      await consumeStream(response);
      await refreshPreflight();
      await refreshStatusPanels();
      await refreshHistory();
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : "Ordered deploy failed.");
      setInfraStatus("failed");
      setConfigStatus("failed");
    } finally {
      setBusyMode(null);
    }
  }

  async function runConfig() {
    if (configTargetModules.length < 1) {
      setError("No generated configuration targets are available.");
      return;
    }
    if (applyPreflight?.ssm_readiness.blocking) {
      setError(
        applyPreflight.ssm_readiness.blocker_message ||
          mapDeployGateError(applyPreflight.ssm_readiness.blocker_code, GENERATION_GUIDANCE),
      );
      return;
    }
    if (!executionState.canRunConfiguration) {
      setError(executionState.blockedReason || GENERATION_GUIDANCE);
      return;
    }
    setBusyMode("config");
    setConfigStatus(null);
    setError("");
    appendLog(setLogs, "=== Starting Post-Provision Configuration ===");
    try {
      const job = await enqueueProjectJob(projectId, {
        kind: "ansible",
        selected_modules: configTargetModules,
        intent: intent || null,
        options: {},
      });
      const response = await streamProjectJobEvents(projectId, job.id);
      await consumeStream(response);
      await refreshStatusPanels();
      await refreshHistory();
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : "Configuration failed.");
      setConfigStatus("failed");
    } finally {
      setBusyMode(null);
    }
  }

  async function runDestroy() {
    if (!destroyPreflight) {
      setError("Deploy readiness is still loading.");
      return;
    }
    if (!hasScopedSelection) {
      setError("Select at least one module for partial scope before destroying.");
      return;
    }
    if (destroyPreflight.review_gate.status !== "fresh") {
      setError(DESTROY_REVIEW_GUIDANCE);
      return;
    }
    setBusyMode("destroy");
    setDestroyStatus(null);
    setError("");
    try {
      const response = await destroyOpenTofuDeployStream(projectId, {
        selected_modules: scopedSelectedModules,
        intent: intent || null,
        review_session_id: reviewSessionId,
        review_target: "destroy",
        scope_mode: scopeMode,
        confirmation: {
          project_name: destroyProjectName,
          keyword: destroyKeyword,
          selected_modules: scopedSelectedModules,
        },
        options: {
          confirm_partial_scope: scopeMode === "partial" ? partialScopeConfirmed : false,
        },
      });
      await consumeStream(response);
      await refreshPreflight();
      await refreshStatusPanels();
      await refreshHistory();
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : "Destroy failed.");
      setDestroyStatus("failed");
    } finally {
      setBusyMode(null);
    }
  }

  async function rerunLatestPostDeploy() {
    if (!latestRun) return;
    setPostDeployRerunBusy(true);
    setError("");
    try {
      const job = await rerunPostDeployChecks(projectId, latestRun.id);
      const response = await streamProjectJobEvents(projectId, job.id);
      await consumeStream(response);
      await refreshStatusPanels();
      await refreshHistory();
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : "Post-deploy rerun failed.");
    } finally {
      setPostDeployRerunBusy(false);
    }
  }

  const applyChecklist = applyPreflight?.checklist ?? [];
  const applyPrimaryBlocker = preflightError
    ? preflightError
    : applyPreflight?.primary_blocker_message || "No active blocker.";
  const applyReviewFresh = applyPreflight?.review_gate.status === "fresh";
  const applyGenerationReady =
    !!applyPreflight &&
    !applyPreflight.credential_gate.blocking &&
    !applyPreflight.generation_gate.blocking;
  const applyDriftReady =
    scopeMode === "full"
      ? applyPreflight?.drift_refresh.source === "primary_backend" &&
        applyPreflight?.drift_refresh.status === "in_sync"
      : applyPreflight?.drift_refresh.source === "primary_backend" &&
        ["in_sync", "drift_detected"].includes(applyPreflight?.drift_refresh.status ?? "") &&
        canPartialApplyProceed;
  const canRunApply =
    busyMode === null &&
    planningTarget === null &&
    status.opentofu_available &&
    hasScopedSelection &&
    applyGenerationReady &&
    applyReviewFresh &&
    !!applyDriftReady;
  const canTriggerPipeline =
    busyMode === null &&
    planningTarget === null &&
    scopeMode === "full" &&
    applyGenerationReady &&
    executionState.canRunPipeline &&
    applyPreflight?.drift_refresh.source === "primary_backend" &&
    applyPreflight?.drift_refresh.status === "in_sync";
  const destroyConfirmationValid =
    destroyProjectName === projectName &&
    destroyKeyword === "destroy" &&
    (scopeMode === "full" || partialScopeConfirmed);
  const destroyCanRun =
    busyMode === null &&
    planningTarget === null &&
    hasScopedSelection &&
    !destroyPreflight?.credential_gate.blocking &&
    destroyPreflight?.review_gate.status === "fresh" &&
    destroyConfirmationValid;
  const canRerunPostDeploy =
    !!latestRun &&
    ["pipeline", "ansible"].includes(latestRun.kind) &&
    (postDeploySummary?.host_count ?? 0) > 0;
  const pipelineButtonLabel =
    planningTarget === "apply"
      ? "Planning..."
      : pipelineReadyForConfirmation
        ? "Continue Deploy Infrastructure + Config"
        : busyMode === "pipeline"
          ? "Deploying..."
          : "Deploy Infrastructure + Config";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>OpenTofu Deploy</DialogTitle>
          <DialogDescription>Plan infrastructure, apply it safely, continue into generated configuration, or destroy reviewed scope.</DialogDescription>
        </DialogHeader>

        <StatusAlert status={status} />

        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <Textarea
            value={intent}
            onChange={(event) => setIntent(event.target.value)}
            placeholder="Optional deploy intent"
            className="min-h-24"
          />
          <Button onClick={() => void loadPreview()} disabled={loadingPreview || !status.opentofu_available}>
            {loadingPreview ? "Previewing..." : "Preview Targets"}
          </Button>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <ScopeSelector
            partialScopeSelected={partialScopeSelected}
            setPartialScopeSelected={setPartialScopeSelected}
            hasPreviewModules={(preview?.modules.length ?? 0) > 0}
          />
          <PreviewModulesCard
            preview={preview}
            selectedModules={selectedModules}
            onToggleModule={(moduleName) =>
              setSelectedModules((previous) => toggleSelectedModule(previous, moduleName))
            }
          />
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <InfrastructureSummaryCard
            graph={infraGraph}
            loading={infraGraphLoading}
            error={infraGraphError}
            onRefresh={() => void refreshStatusPanels()}
          />
          <SectionCard
            title="Terraform Target Handoff"
            description="Review or refresh the canonical Terraform target preview before configuration starts."
          >
            <TerraformTargetHandoffPanel
              targetContract={targetContract}
              refreshBusy={targetContractRefreshBusy}
              refreshError={targetContractRefreshError}
              onRefresh={() => void refreshTargetContractPreview()}
            />
          </SectionCard>
        </div>

        <SsmReadinessSection readiness={applyPreflight?.ssm_readiness} />

        <AnsibleStatusCard
          status={ansibleStatus}
          opentofuStatus={status}
          loading={ansibleLoading}
          error={ansibleError}
          onRefresh={() => void refreshStatusPanels()}
        />

        <SectionCard
          title="Deploy Readiness"
          description="Use the current preflight contract instead of launching a mutating run blind."
        >
          <div className="space-y-1">
            <p className="text-sm font-semibold">Primary blocker</p>
            <p className="text-xs text-[var(--da-muted)]">{applyPrimaryBlocker}</p>
          </div>
          <DeployChecklist checklist={applyChecklist} />
        </SectionCard>

        <SectionCard
          title="Apply Infrastructure"
          description="Plan first, then apply or continue the ordered deploy with explicit confirmation."
        >
          <StatusPills infraStatus={infraStatus} configStatus={configStatus} destroyStatus={destroyStatus} />
          <label className="flex items-center gap-2 text-xs text-[var(--da-muted)]">
            <input
              type="checkbox"
              checked={overridePolicy}
              onChange={(event) => setOverridePolicy(event.target.checked)}
            />
            Override policy gate for apply (audit event still recorded)
          </label>
          {scopeMode === "partial" ? (
            <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-100">
              <AlertTitle>Advanced partial apply</AlertTitle>
              <AlertDescription>{PARTIAL_APPLY_WARNING}</AlertDescription>
            </Alert>
          ) : null}
          {scopeMode === "partial" ? (
            <label className="flex items-center gap-2 text-xs text-[var(--da-muted)]">
              <input
                type="checkbox"
                checked={partialScopeConfirmed}
                onChange={(event) => setPartialScopeConfirmed(event.target.checked)}
              />
              {PARTIAL_SCOPE_GUIDANCE}
            </label>
          ) : null}
          {scopeMode === "partial" && applyPreflight?.drift_refresh.status === "drift_detected" ? (
            <label className="flex items-center gap-2 text-xs text-[var(--da-muted)]">
              <input
                type="checkbox"
                checked={partialDriftOverrideConfirmed}
                onChange={(event) => setPartialDriftOverrideConfirmed(event.target.checked)}
              />
              {PARTIAL_DRIFT_OVERRIDE_COPY}
            </label>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => void runPlan("apply")}
              disabled={planningTarget !== null || busyMode !== null || !hasScopedSelection}
            >
              {planningTarget === "apply" ? "Planning..." : "Run Plan"}
            </Button>
            <Button variant="outline" onClick={() => void runApply()} disabled={!canRunApply}>
              {busyMode === "apply" ? "Applying..." : "Apply Infrastructure Only"}
            </Button>
            <Button onClick={() => void runPipeline()} disabled={!canTriggerPipeline}>
              {pipelineButtonLabel}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void runConfig()}
              disabled={
                busyMode !== null ||
                planningTarget !== null ||
                configReadinessBlocking ||
                !executionState.canRunConfiguration
              }
            >
              {busyMode === "config" ? "Configuring..." : "Run Configuration"}
            </Button>
          </div>
          {!applyReviewFresh ? <p className="text-xs text-[var(--da-muted)]">{PLAN_REVIEW_GUIDANCE}</p> : null}
          {scopeMode === "partial" && applyPreflight?.drift_refresh.status === "drift_detected" ? (
            <p className="text-xs text-[var(--da-muted)]">{DRIFT_OVERRIDE_GUIDANCE}</p>
          ) : null}
          {scopeMode === "partial" ? <p className="text-xs text-[var(--da-muted)]">{buildPartialScopeWarning("apply")}</p> : null}
        </SectionCard>

        <SectionCard
          title="Destroy"
          description="Destroy is gated by a reviewed destroy plan and typed confirmation."
        >
          {scopeMode === "partial" ? (
            <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-100">
              <AlertTitle>Advanced partial destroy</AlertTitle>
              <AlertDescription>{PARTIAL_DESTROY_WARNING}</AlertDescription>
            </Alert>
          ) : null}
          {destroyPreflight?.credential_gate.blocking ? (
            <p className="text-xs text-[var(--da-muted)]">{SAVED_CREDENTIALS_GUIDANCE}</p>
          ) : null}
          {destroyPreflight?.review_gate.status !== "fresh" ? (
            <p className="text-xs text-[var(--da-muted)]">{DESTROY_REVIEW_GUIDANCE}</p>
          ) : null}
          {scopeMode === "partial" ? <p className="text-xs text-[var(--da-muted)]">{buildPartialScopeWarning("destroy")}</p> : null}
          <DestroyConfirmationFields
            projectName={projectName}
            destroyProjectName={destroyProjectName}
            destroyKeyword={destroyKeyword}
            onProjectNameChange={setDestroyProjectName}
            onKeywordChange={setDestroyKeyword}
            selectedModules={scopedSelectedModules}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => void runPlan("destroy")}
              disabled={planningTarget !== null || busyMode !== null || !hasScopedSelection}
            >
              {planningTarget === "destroy" ? "Planning..." : "Run Destroy Plan"}
            </Button>
            <Button variant="destructive" onClick={() => void runDestroy()} disabled={!destroyCanRun}>
              {busyMode === "destroy" ? "Destroying..." : "Destroy Infrastructure"}
            </Button>
          </div>
          <p className="text-xs text-[var(--da-muted)]">{DESTROY_HELPER_COPY}</p>
        </SectionCard>

        <PostDeployLoggingCard
          summary={postDeploySummary}
          hosts={postDeployHosts}
          disabled={!canRerunPostDeploy}
          busy={postDeployRerunBusy}
          onRerun={() => void rerunLatestPostDeploy()}
        />

        <SectionCard
          title="Run Guidance"
          description="Exact deploy-gate guidance used by the current execution flow."
        >
          <div className="grid gap-2 text-xs text-[var(--da-muted)] md:grid-cols-2">
            <p>{SAVED_CREDENTIALS_GUIDANCE}</p>
            <p>{GENERATION_GUIDANCE}</p>
            <p>{PLAN_REVIEW_GUIDANCE}</p>
            <p>{DESTROY_REVIEW_GUIDANCE}</p>
            <p>{DRIFT_REFRESH_GUIDANCE}</p>
            <p>{DRIFT_OVERRIDE_GUIDANCE}</p>
            <p>{PARTIAL_SCOPE_GUIDANCE}</p>
            <p>{DESTROY_CONFIRMATION_GUIDANCE}</p>
          </div>
        </SectionCard>

        {error ? (
          <Alert className="border-red-500/40 bg-red-500/10 text-red-100">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {preflightLoading ? <p className="text-xs text-[var(--da-muted)]">Refreshing deploy readiness...</p> : null}
        <ScrollArea className="h-52 rounded-md border border-[var(--da-border)] bg-[var(--da-bg)] p-3 font-mono text-xs text-blue-100/90">
          {logs.length < 1 ? (
            <p className="text-[var(--da-muted)]">Run logs will appear here...</p>
          ) : (
            logs.map((line, index) => <div key={`${index}-${line.slice(0, 12)}`}>{line}</div>)
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
