import { RefreshCw } from "lucide-react";

import type { ProjectJob, ProjectJobEvent, ProjectJobKind, ProjectJobStatus } from "../../../api/projects";
import { Button } from "../../../components/ui/button";
import { buildStageSummary, eventStage } from "./events";

const STAGE_ORDER = [
  { key: "apply", title: "Provisioning" },
  { key: "ssm_readiness", title: "SSM readiness" },
  { key: "ansible", title: "Configuration" },
  { key: "post_deploy", title: "Post-deploy logging" },
] as const;

const STATUS_OPTIONS: Array<{ label: string; value: ProjectJobStatus | "" }> = [
  { label: "All statuses", value: "" },
  { label: "Queued", value: "queued" },
  { label: "Running", value: "running" },
  { label: "Succeeded", value: "succeeded" },
  { label: "Failed", value: "failed" },
  { label: "Canceled", value: "canceled" },
];

const KIND_OPTIONS: Array<{ label: string; value: ProjectJobKind | "" }> = [
  { label: "All kinds", value: "" },
  { label: "Pipeline", value: "pipeline" },
  { label: "Apply", value: "apply" },
  { label: "Plan", value: "plan" },
  { label: "Destroy", value: "destroy" },
  { label: "Ansible", value: "ansible" },
  { label: "Graph", value: "graph" },
  { label: "Cost", value: "cost" },
];

function statusTone(status: ProjectJobStatus) {
  if (status === "succeeded") return "text-emerald-600";
  if (status === "failed") return "text-red-600";
  if (status === "running") return "text-blue-600";
  if (status === "canceled") return "text-amber-700";
  return "text-[var(--da-muted)]";
}

export function JobsWorkspaceSidebarPanel(props: {
  jobs: ProjectJob[];
  loading: boolean;
  error: string;
  statusFilter: ProjectJobStatus | "";
  kindFilter: ProjectJobKind | "";
  selectedJobId: string | null;
  onStatusFilter: (value: ProjectJobStatus | "") => void;
  onKindFilter: (value: ProjectJobKind | "") => void;
  onSelectJob: (jobId: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col border-r border-[var(--da-border)] bg-[var(--da-elevated)]">
      <div className="space-y-2 border-b border-[var(--da-border)] p-3">
        <div className="grid grid-cols-2 gap-2">
          <select
            value={props.statusFilter}
            onChange={(event) => props.onStatusFilter(event.target.value as ProjectJobStatus | "")}
            className="h-8 rounded border border-[var(--da-border)] bg-[var(--da-panel)] px-2 text-xs text-[var(--da-text)]"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.label} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select
            value={props.kindFilter}
            onChange={(event) => props.onKindFilter(event.target.value as ProjectJobKind | "")}
            className="h-8 rounded border border-[var(--da-border)] bg-[var(--da-panel)] px-2 text-xs text-[var(--da-text)]"
          >
            {KIND_OPTIONS.map((option) => (
              <option key={option.label} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <Button size="sm" variant="outline" className="h-8 w-full" onClick={props.onRefresh}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" />Refresh Jobs
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {props.loading ? <p className="px-2 py-3 text-xs text-[var(--da-muted)]">Loading jobs...</p> : null}
        {props.error ? <p className="px-2 py-3 text-xs text-red-600">{props.error}</p> : null}
        {props.jobs.map((job) => (
          <button
            key={job.id}
            type="button"
            onClick={() => props.onSelectJob(job.id)}
            className={`mb-1 w-full rounded border px-2 py-2 text-left ${props.selectedJobId === job.id ? "border-blue-400/50 bg-blue-500/10" : "border-[var(--da-border)] bg-[var(--da-panel)] hover:bg-[var(--da-elevated)]"}`}
          >
            <div className="mb-0.5 flex items-center justify-between gap-2 text-xs uppercase tracking-[0.1em]">
              <span className="text-[var(--da-muted)]">{job.kind}</span>
              <span className={statusTone(job.status)}>{job.status}</span>
            </div>
            <div className="truncate font-mono text-[11px] text-[var(--da-text)]">{job.id}</div>
            <div className="mt-1 line-clamp-2 text-[11px] text-[var(--da-muted)]">{sidebarSummary(job)}</div>
          </button>
        ))}
        {!props.loading && props.jobs.length < 1 ? <p className="px-2 py-3 text-xs text-[var(--da-muted)]">No jobs found.</p> : null}
      </div>
    </div>
  );
}

function buildEventLine(event: ProjectJobEvent) {
  const seq = typeof event.seq === "number" ? `${event.seq}`.padStart(4, "0") : "----";
  const type = typeof event.type === "string" ? event.type : "unknown";
  const status = typeof event.status === "string" ? ` ${event.status}` : "";
  const message = typeof event.message === "string" ? ` ${event.message}` : "";
  return `[${seq}] ${type}${status}${message}`;
}

function resultSummary(job: ProjectJob): string {
  if (job.error && typeof job.error === "object") {
    const message = (job.error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  if (!job.result || typeof job.result !== "object") return "-";
  const status = (job.result as { status?: unknown }).status;
  if (typeof status === "string" && status.trim()) return `status=${status}`;
  return "result available";
}

function sidebarSummary(job: ProjectJob): string {
  const summary = buildStageSummary(job, job.event_tail);
  if (summary) {
    const parts = STAGE_ORDER.map((stage) =>
      summary[stage.key] ? `${stage.title} ${stageStatusLabel(summary[stage.key]?.status)}` : null,
    ).filter(Boolean);
    if (parts.length > 0) return parts.join(" · ");
  }
  return resultSummary(job);
}

function stageStatusLabel(status?: string) {
  if (!status) return "unknown";
  if (status === "ok") return "succeeded";
  return status;
}

function buildStageChain(job: ProjectJob, events: ProjectJobEvent[]) {
  const summary = buildStageSummary(job, events);
  if (!summary) return "";
  const parts = STAGE_ORDER.map((stage) =>
    summary[stage.key] ? `${stage.title} ${stageStatusLabel(summary[stage.key]?.status)}` : null,
  ).filter(Boolean);
  return parts.join(" · ");
}

function groupedStageEvents(events: ProjectJobEvent[]) {
  return {
    apply: events.filter((event) => eventStage(event) === "apply"),
    ssm_readiness: events.filter((event) => eventStage(event) === "ssm_readiness"),
    ansible: events.filter((event) => eventStage(event) === "ansible"),
    post_deploy: events.filter((event) => eventStage(event) === "post_deploy"),
  };
}

function StageSection({
  title,
  state,
  events,
}: {
  title: string;
  state?: { status?: string; message?: string | null } | null;
  events: ProjectJobEvent[];
}) {
  if (!state && events.length < 1) return null;
  return (
    <div className="rounded border border-[var(--da-border)] bg-[var(--da-elevated)] p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-[var(--da-text)]">{title}</p>
        <span className="text-xs uppercase text-[var(--da-muted)]">{stageStatusLabel(state?.status)}</span>
      </div>
      {state?.message ? <p className="mb-2 text-xs text-[var(--da-muted)]">{state.message}</p> : null}
      <details open className="text-[11px] text-[color-mix(in_srgb,var(--da-text)_82%,transparent)]">
        <summary className="cursor-pointer font-mono text-[11px] text-[var(--da-muted)]">Raw events</summary>
        <div className="mt-2 space-y-1 font-mono">
          {events.length < 1 ? <p className="text-[var(--da-muted)]">No raw events for this stage.</p> : null}
          {events.map((event, index) => (
            <div key={`${title}-${index}-${event.type}-${String(event.seq ?? "")}`}>{buildEventLine(event)}</div>
          ))}
        </div>
      </details>
    </div>
  );
}

export function JobsWorkspaceMainPanel(props: {
  selectedJob: ProjectJob | null;
  selectedSummary: string;
  events: ProjectJobEvent[];
  streaming: boolean;
  onCancel: () => void;
  onRerun: () => void;
}) {
  if (!props.selectedJob) {
    return <div className="flex h-full items-center justify-center text-sm text-[var(--da-muted)]">Select a job to view details.</div>;
  }
  const canCancel = props.selectedJob.status === "queued" || props.selectedJob.status === "running";
  const createdAt = props.selectedJob.created_at ? new Date(props.selectedJob.created_at).toLocaleString() : "-";
  const stageSummary = buildStageSummary(props.selectedJob, props.events);
  const stageEvents = groupedStageEvents(props.events);
  const stageChain = buildStageChain(props.selectedJob, props.events);
  const showStageView = Boolean(
    stageSummary?.apply ||
      stageSummary?.ssm_readiness ||
      stageSummary?.ansible ||
      stageSummary?.post_deploy ||
      stageEvents.apply.length ||
      stageEvents.ssm_readiness.length ||
      stageEvents.ansible.length ||
      stageEvents.post_deploy.length,
  );
  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--da-bg)]">
      <div className="space-y-2 border-b border-[var(--da-border)] p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[var(--da-text)]">{props.selectedSummary}</p>
            <p className="font-mono text-[11px] text-[var(--da-muted)]">{props.selectedJob.id}</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={props.onCancel} disabled={!canCancel}>Cancel</Button>
            <Button size="sm" onClick={props.onRerun}>Rerun</Button>
          </div>
        </div>
        <p className="text-xs text-[var(--da-muted)]">Created: {createdAt} {props.streaming ? "· streaming" : ""}</p>
        <p className="text-xs text-[var(--da-muted)]">Summary: {stageChain || resultSummary(props.selectedJob)}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 font-mono text-[11px] text-[color-mix(in_srgb,var(--da-text)_82%,transparent)]">
        {showStageView ? (
          <div className="space-y-3 font-sans text-sm">
            <StageSection title="Provisioning" state={stageSummary?.apply} events={stageEvents.apply} />
            <StageSection title="SSM readiness" state={stageSummary?.ssm_readiness} events={stageEvents.ssm_readiness} />
            <StageSection title="Configuration" state={stageSummary?.ansible} events={stageEvents.ansible} />
            <StageSection title="Post-deploy logging" state={stageSummary?.post_deploy} events={stageEvents.post_deploy} />
          </div>
        ) : (
          <>
            {props.events.length < 1 ? <p className="text-[var(--da-muted)]">No events yet.</p> : null}
            {props.events.map((event, index) => (
              <div key={`${index}-${event.type}-${String(event.seq ?? "")}`} className="mb-1">{buildEventLine(event)}</div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
