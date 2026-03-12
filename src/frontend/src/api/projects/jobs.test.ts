import { afterEach, describe, expect, it, vi } from "vitest";

import { enqueueProjectJob, listProjectJobs } from "./jobs";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("jobs api", () => {
  it("sends enqueue payload to jobs endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "job-1", kind: "plan", status: "queued" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await enqueueProjectJob("p1", { kind: "plan", selected_modules: ["vpc"], intent: "test", options: {} });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/projects/p1/jobs");
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain('"kind":"plan"');
  });

  it("builds list query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ total: 0, items: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await listProjectJobs("p1", { status: "running", kind: "apply", limit: 10, offset: 5 });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("/api/projects/p1/jobs?");
    expect(url).toContain("status=running");
    expect(url).toContain("kind=apply");
    expect(url).toContain("limit=10");
    expect(url).toContain("offset=5");
  });
});
