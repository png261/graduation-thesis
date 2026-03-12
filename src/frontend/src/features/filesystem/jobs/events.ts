import type { ProjectJob, ProjectJobEvent } from "../../../api/projects";

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
