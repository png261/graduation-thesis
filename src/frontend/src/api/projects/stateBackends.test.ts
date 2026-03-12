import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getDriftAlerts,
  importStateBackendFromGitHub,
  listCloudObjects,
  updateStateBackendSettings,
} from "./stateBackends";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("stateBackends api", () => {
  it("builds cloud objects query with prefix", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ objects: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await listCloudObjects("p1", {
      provider: "aws",
      credentialProfileId: "cp-1",
      bucket: "tf-state",
      prefix: "states/",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/projects/p1/state-backends/import/cloud/objects?");
    expect(url).toContain("provider=aws");
    expect(url).toContain("credential_profile_id=cp-1");
    expect(url).toContain("bucket=tf-state");
    expect(url).toContain("prefix=states%2F");
    expect(init.credentials).toBe("include");
  });

  it("posts github import payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ discovered: [], created: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await importStateBackendFromGitHub("p1", {
      repo_full_name: "org/repo",
      branch: "main",
      credential_profile_id: "cp-1",
      dry_run: true,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/projects/p1/state-backends/import/github");
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain('"repo_full_name":"org/repo"');
    expect(String(init.body)).toContain('"dry_run":true');
  });

  it("builds drift alerts query for active_only and search", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ alerts: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await getDriftAlerts("p1", "sb-1", { activeOnly: true, search: "vpc" });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("/api/projects/p1/state-backends/sb-1/drift-alerts?");
    expect(url).toContain("active_only=true");
    expect(url).toContain("search=vpc");
  });

  it("updates settings via PUT", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "sb-1", name: "backend-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await updateStateBackendSettings("p1", "sb-1", {
      name: "backend-1",
      schedule_minutes: 30,
      retention_days: 120,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/projects/p1/state-backends/sb-1/settings");
    expect(init.method).toBe("PUT");
    expect(String(init.body)).toContain('"schedule_minutes":30');
    expect(String(init.body)).toContain('"retention_days":120');
  });
});
