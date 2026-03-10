export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

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

export async function apiRequest(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_URL}${path}`, init);
}
