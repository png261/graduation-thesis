import { afterEach, describe, expect, it, vi } from "vitest";

import { getGitLabOauthStart, getGitLabSession, listGitLabRepos } from "./gitlab";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("gitlab api", () => {
  it("loads gitlab session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ authenticated: true, login: "alice" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await getGitLabSession();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/gitlab/session");
    expect(init.credentials).toBe("include");
  });

  it("loads oauth start url", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ authorize_url: "https://gitlab.com/oauth/authorize" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const data = await getGitLabOauthStart();

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("/api/gitlab/oauth/start");
    expect(data.authorize_url).toContain("gitlab.com/oauth/authorize");
  });

  it("loads repos list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ repos: [{ full_name: "group/repo" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const repos = await listGitLabRepos();

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("/api/gitlab/repos");
    expect(repos).toEqual([{ full_name: "group/repo" }]);
  });
});
