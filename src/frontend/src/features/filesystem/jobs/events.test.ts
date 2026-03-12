import { describe, expect, it } from "vitest";

import type { ProjectJob } from "../../../api/projects";
import { maxEventSeq, shouldStream, toEvent } from "./events";

describe("toEvent", () => {
  it("returns null for invalid event payload", () => {
    expect(toEvent(null)).toBeNull();
    expect(toEvent({})).toBeNull();
    expect(toEvent({ type: 1 })).toBeNull();
  });

  it("parses valid job event payload", () => {
    const parsed = toEvent({ type: "job.queued", seq: 2 });
    expect(parsed).toEqual({ type: "job.queued", seq: 2 });
  });
});

describe("shouldStream", () => {
  function makeJob(status: ProjectJob["status"]): ProjectJob {
    return {
      id: "job-1",
      project_id: "p1",
      user_id: "u1",
      kind: "plan",
      status,
      params: {},
      result: null,
      error: null,
      event_tail: [],
      celery_task_id: null,
      rerun_of_job_id: null,
      created_at: null,
      started_at: null,
      finished_at: null,
      cancel_requested_at: null,
    };
  }

  it("streams only queued and running jobs", () => {
    expect(shouldStream(makeJob("queued"))).toBe(true);
    expect(shouldStream(makeJob("running"))).toBe(true);
    expect(shouldStream(makeJob("succeeded"))).toBe(false);
    expect(shouldStream(makeJob("failed"))).toBe(false);
  });
});

describe("maxEventSeq", () => {
  it("extracts max seq from event list", () => {
    expect(maxEventSeq([{ type: "job.log", seq: 2 }, { type: "job.log", seq: 5 }])).toBe(5);
  });

  it("defaults to zero when events are missing seq", () => {
    expect(maxEventSeq([{ type: "job.log" }])).toBe(0);
    expect(maxEventSeq([])).toBe(0);
  });
});
