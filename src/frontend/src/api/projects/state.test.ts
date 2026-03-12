import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createCredentialProfile,
  deleteCredentialProfile,
  listCredentialProfiles,
  updateCredentialProfile,
} from "./state";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("state credential profiles api", () => {
  it("lists profiles", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ profiles: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await listCredentialProfiles();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/state/credential-profiles");
    expect(init.credentials).toBe("include");
  });

  it("creates profile with POST body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "cp-1", name: "aws-main", provider: "aws", credentials: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await createCredentialProfile({
      name: "aws-main",
      provider: "aws",
      credentials: { aws_access_key_id: "ak" },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/state/credential-profiles");
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain('"provider":"aws"');
  });

  it("updates and deletes profile", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "cp-1", name: "updated", provider: "aws", credentials: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await updateCredentialProfile("cp-1", { name: "updated" });
    await deleteCredentialProfile("cp-1");

    const [updateUrl, updateInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [deleteUrl, deleteInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(updateUrl).toContain("/api/state/credential-profiles/cp-1");
    expect(updateInit.method).toBe("PUT");
    expect(deleteUrl).toContain("/api/state/credential-profiles/cp-1");
    expect(deleteInit.method).toBe("DELETE");
  });
});
