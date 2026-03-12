import { apiJson, apiRequest } from "../client";
import type { CredentialProfile } from "./types";

export async function listCredentialProfiles(): Promise<CredentialProfile[]> {
  const res = await apiRequest("/api/state/credential-profiles", {
    credentials: "include",
  });
  const data = await apiJson<{ profiles: CredentialProfile[] }>(res);
  return data.profiles;
}

export async function createCredentialProfile(payload: {
  name: string;
  provider: string;
  credentials: Record<string, unknown>;
  meta?: Record<string, unknown>;
}): Promise<CredentialProfile> {
  const res = await apiRequest("/api/state/credential-profiles", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return apiJson<CredentialProfile>(res);
}

export async function updateCredentialProfile(
  profileId: string,
  payload: {
    name?: string;
    credentials?: Record<string, unknown>;
    meta?: Record<string, unknown>;
  },
): Promise<CredentialProfile> {
  const res = await apiRequest(`/api/state/credential-profiles/${profileId}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return apiJson<CredentialProfile>(res);
}

export async function deleteCredentialProfile(profileId: string): Promise<void> {
  const res = await apiRequest(`/api/state/credential-profiles/${profileId}`, {
    method: "DELETE",
    credentials: "include",
  });
  await apiJson<{ ok: boolean }>(res);
}
