const ENV_API_URL = import.meta.env.VITE_API_URL;
const SAME_ORIGIN_API_TOKEN = "__SAME_ORIGIN__";
const DEFAULT_API_URL = "";
const resolvedApiUrl = (ENV_API_URL ?? DEFAULT_API_URL).trim();
const normalizedApiUrl = resolvedApiUrl === SAME_ORIGIN_API_TOKEN ? "" : resolvedApiUrl;
export const API_URL = normalizedApiUrl.replace(/\/+$/, "");
const AUTH_TOKEN_TIMEOUT_MS = 5000;
const REQUEST_TIMEOUT_MS = 20000;
const API_FALLBACKS = ["http://localhost:8000", "http://127.0.0.1:8000"] as const;

type TokenGetter = () => Promise<string | null> | string | null;
let authTokenGetter: TokenGetter | null = null;

interface PreparedHeaders {
  headers: Headers;
  hasAuthorization: boolean;
}

export function setAuthTokenGetter(getter: TokenGetter | null): void {
  authTokenGetter = getter;
}

async function parseErrorResponse(res: Response): Promise<string> {
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (data !== null) {
    const detail = (data as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail === "object") {
      const message = (detail as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message;
      return JSON.stringify(detail);
    }
    const message = (data as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
    return JSON.stringify(data);
  }

  const text = await res.text().catch(() => res.statusText);
  return text || res.statusText || "Request failed";
}

export async function apiJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new Error(await parseErrorResponse(res));
  }
  return res.json() as Promise<T>;
}

function bindAbortSignal(signal: AbortSignal | null | undefined, controller: AbortController): void {
  if (!signal) return;
  if (signal.aborted) {
    controller.abort();
    return;
  }
  signal.addEventListener("abort", () => controller.abort(), { once: true });
}

function joinBaseAndPath(baseUrl: string, path: string): string {
  if (!baseUrl) return path;
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function isRetryableNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    return lower.includes("timed out") || lower.includes("failed to fetch") || lower.includes("networkerror");
  }
  return false;
}

function isRetryableResponseStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

async function resolveAuthToken(): Promise<string | null> {
  if (!authTokenGetter) return null;
  try {
    const tokenPromise = Promise.resolve(authTokenGetter()).catch(() => null);
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), AUTH_TOKEN_TIMEOUT_MS);
    });
    return await Promise.race([tokenPromise, timeoutPromise]);
  } catch {
    return null;
  }
}

async function prepareHeaders(initHeaders?: HeadersInit): Promise<PreparedHeaders> {
  const headers = new Headers(initHeaders ?? {});
  if (headers.has("Authorization")) return { headers, hasAuthorization: true };
  const token = await resolveAuthToken();
  if (!token) return { headers, hasAuthorization: false };
  headers.set("Authorization", `Bearer ${token}`);
  return { headers, hasAuthorization: true };
}

export async function apiRequest(path: string, init?: RequestInit): Promise<Response> {
  let preparedHeaders = await prepareHeaders(init?.headers);

  const candidateBases =
    API_URL === ""
      ? ["", ...API_FALLBACKS]
      : [API_URL];

  let lastError: unknown = null;

  for (let index = 0; index < candidateBases.length; index += 1) {
    const baseUrl = candidateBases[index];
    const controller = new AbortController();
    bindAbortSignal(init?.signal, controller);

    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
      let response = await fetch(joinBaseAndPath(baseUrl, path), {
        ...init,
        headers: preparedHeaders.headers,
        signal: controller.signal,
      });
      if (response.status === 401 && !preparedHeaders.hasAuthorization && authTokenGetter) {
        const retriedHeaders = await prepareHeaders(init?.headers);
        if (retriedHeaders.hasAuthorization) {
          preparedHeaders = retriedHeaders;
          response = await fetch(joinBaseAndPath(baseUrl, path), {
            ...init,
            headers: preparedHeaders.headers,
            signal: controller.signal,
          });
        }
      }
      if (isRetryableResponseStatus(response.status) && index < candidateBases.length - 1) {
        lastError = new Error(`Upstream unavailable (${response.status})`);
        continue;
      }
      return response;
    } catch (error) {
      if (timedOut) {
        lastError = new Error(`Request timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s`);
      } else if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("Request was cancelled");
      } else {
        lastError = error;
      }

      if (!isRetryableNetworkError(lastError) || index >= candidateBases.length - 1) {
        throw lastError;
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Request failed");
}
