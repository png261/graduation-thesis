import type { ProjectJob, ProjectJobEvent, ProjectJobStageSummary } from "../../../api/projects";

type JobStage = "apply" | "ssm_readiness" | "ansible" | "post_deploy";

export function toEvent(raw: unknown): ProjectJobEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.type !== "string") return null;
  return value as ProjectJobEvent;
}

export function shouldStream(job: ProjectJob | null): boolean {
  if (!job) return false;
  return job.status === "queued" || job.status === "running";
}

export function maxEventSeq(events: ProjectJobEvent[]): number {
  return Math.max(0, ...events.map((row) => Number(row.seq || 0)));
}

export function eventStage(event: ProjectJobEvent): JobStage | null {
  const explicitStage = typeof event.stage === "string" ? event.stage : "";
  if (
    explicitStage === "apply"
    || explicitStage === "ssm_readiness"
    || explicitStage === "ansible"
    || explicitStage === "post_deploy"
  ) {
    return explicitStage;
  }
  if (event.type.startsWith("deploy.") || event.type === "module.start" || event.type === "module.done") {
    return "apply";
  }
  if (event.type.startsWith("ssm_readiness.")) {
    return "ssm_readiness";
  }
  if (event.type.startsWith("config.") || event.type.startsWith("host.") || event.type === "task.log") {
    return "ansible";
  }
  if (event.type.startsWith("post_deploy.")) {
    return "post_deploy";
  }
  return null;
}

function terminalStatus(events: ProjectJobEvent[], type: string): string | undefined {
  const match = [...events].reverse().find((event) => event.type === type);
  return typeof match?.status === "string" ? match.status : undefined;
}

function latestStageStatus(events: ProjectJobEvent[], eventTypes: string[]): string | undefined {
  const match = [...events].reverse().find((event) => eventTypes.includes(event.type));
  return typeof match?.status === "string" ? match.status : undefined;
}

export function buildStageSummary(job: ProjectJob, events: ProjectJobEvent[]): ProjectJobStageSummary | undefined {
  if (job.stage_summary) return job.stage_summary;
  if (job.kind === "pipeline") {
    return {
      apply: terminalStatus(events, "deploy.done")
        ? { status: terminalStatus(events, "deploy.done") as string }
        : undefined,
      ssm_readiness: latestStageStatus(events, ["ssm_readiness.done", "ssm_readiness.progress", "ssm_readiness.start"])
        ? { status: latestStageStatus(events, ["ssm_readiness.done", "ssm_readiness.progress", "ssm_readiness.start"]) as string }
        : undefined,
      ansible: terminalStatus(events, "config.done")
        ? { status: terminalStatus(events, "config.done") as string }
        : undefined,
      post_deploy: terminalStatus(events, "post_deploy.done")
        ? { status: terminalStatus(events, "post_deploy.done") as string }
        : undefined,
    };
  }
  if (job.kind === "ansible") {
    return {
      ansible: terminalStatus(events, "config.done")
        ? { status: terminalStatus(events, "config.done") as string }
        : undefined,
      post_deploy: terminalStatus(events, "post_deploy.done")
        ? { status: terminalStatus(events, "post_deploy.done") as string }
        : undefined,
    };
  }
  return undefined;
}
