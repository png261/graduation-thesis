import { apiJson, apiRequest } from "../client";

export async function importGuestProject(body: {
  name: string;
  provider: "aws" | "gcloud";
  files: Array<{ path: string; content: string }>;
  threads: Array<{ id: string; title: string }>;
}): Promise<{ id: string; name: string; provider: "aws" | "gcloud"; createdAt: string }> {
  const res = await apiRequest("/api/projects/import-guest", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return apiJson(res);
}
