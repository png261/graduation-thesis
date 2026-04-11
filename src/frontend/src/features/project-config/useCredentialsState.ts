import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createCredentialProfile,
  deleteCredentialProfile,
  getCredentials,
  listCredentialProfiles,
  updateCredentials,
  type CredentialProfile,
} from "../../api/projects";
import { AWS_FIELDS, GCP_FIELDS, type ProviderField } from "./constants";

const LOAD_TIMEOUT_MS = 10_000;
const SAVED_BADGE_MS = 2_000;

type ProfileProvider = "aws" | "gcs";

function toProfileProvider(provider: string | null | undefined): ProfileProvider | null {
  if (provider === "aws") return "aws";
  if (provider === "gcloud") return "gcs";
  return null;
}

function resolveProviderFields(provider: ProfileProvider | null): ProviderField[] {
  if (provider === "aws") return AWS_FIELDS;
  if (provider === "gcs") return GCP_FIELDS;
  return [];
}

function buildCredentialPatch(providerFields: ProviderField[], credentialFields: Record<string, string>) {
  const patch: Record<string, string> = {};
  for (const { key } of providerFields) {
    const value = credentialFields[key];
    if (value) patch[key] = value;
  }
  return patch;
}

function toLoadError(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") {
    return "Loading profiles timed out. Check API server and try again.";
  }
  return error instanceof Error ? error.message : "Failed to load credential profiles";
}

function initialProfileFields(providerFields: ProviderField[]) {
  return Object.fromEntries(providerFields.map(({ key }) => [key, ""]));
}

export function useCredentialsState(projectId: string, fallbackProvider: string | null | undefined) {
  const profileProvider = useMemo(() => toProfileProvider(fallbackProvider), [fallbackProvider]);
  const providerFields = useMemo(() => resolveProviderFields(profileProvider), [profileProvider]);
  const [profiles, setProfiles] = useState<CredentialProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [appliedProfileId, setAppliedProfileId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profileFields, setProfileFields] = useState<Record<string, string>>({});
  const [missingCredentialFields, setMissingCredentialFields] = useState<string[]>([]);
  const [applyReady, setApplyReady] = useState(false);
  const [credentialsLoading, setCredentialsLoading] = useState(true);
  const [credentialsSaving, setCredentialsSaving] = useState(false);
  const [credentialsSaved, setCredentialsSaved] = useState(false);
  const [credentialsError, setCredentialsError] = useState("");
  const [profileDeletingId, setProfileDeletingId] = useState<string | null>(null);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );
  const appliedProfile = useMemo(
    () => profiles.find((profile) => profile.id === appliedProfileId) ?? null,
    [appliedProfileId, profiles],
  );

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!profileProvider) {
        setProfiles([]);
        setSelectedProfileId("");
        setAppliedProfileId(null);
        setMissingCredentialFields([]);
        setApplyReady(false);
        setProfileFields({});
        return;
      }
      const [credentialsData, allProfiles] = await Promise.all([
        getCredentials(projectId, signal ? { signal } : undefined),
        listCredentialProfiles(),
      ]);
      const matchingProfiles = allProfiles.filter((profile) => profile.provider === profileProvider);
      setProfiles(matchingProfiles);
      setAppliedProfileId(credentialsData.credential_profile_id ?? null);
      setSelectedProfileId((current) => current || credentialsData.credential_profile_id || matchingProfiles[0]?.id || "");
      setMissingCredentialFields(credentialsData.missing_fields ?? []);
      setApplyReady(Boolean(credentialsData.apply_ready));
      setProfileFields((current) => {
        const base = initialProfileFields(providerFields);
        return Object.keys(current).length > 0 ? { ...base, ...current } : base;
      });
    },
    [profileProvider, projectId, providerFields],
  );

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);
    setCredentialsLoading(true);
    setCredentialsError("");
    void refresh(controller.signal)
      .catch((error: unknown) => {
        if (!active) return;
        setCredentialsError(toLoadError(error));
      })
      .finally(() => {
        if (!active) return;
        window.clearTimeout(timeout);
        setCredentialsLoading(false);
      });
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [refresh]);

  const createProfile = useCallback(async () => {
    if (!profileProvider) {
      setCredentialsError("Create a project with cloud provider first.");
      return;
    }
    const name = profileName.trim();
    if (!name) {
      setCredentialsError("Profile name is required.");
      return;
    }
    const credentials = buildCredentialPatch(providerFields, profileFields);
    if (Object.keys(credentials).length < 1) {
      setCredentialsError("Fill in the profile credentials before saving.");
      return;
    }
    setCredentialsSaving(true);
    setCredentialsSaved(false);
    setCredentialsError("");
    try {
      const profile = await createCredentialProfile({
        name,
        provider: profileProvider,
        credentials,
      });
      setProfileName("");
      setProfileFields(initialProfileFields(providerFields));
      await refresh();
      setSelectedProfileId(profile.id);
      setCredentialsSaved(true);
      window.setTimeout(() => setCredentialsSaved(false), SAVED_BADGE_MS);
    } catch (error: unknown) {
      setCredentialsError(error instanceof Error ? error.message : "Failed to create profile");
    } finally {
      setCredentialsSaving(false);
    }
  }, [profileFields, profileName, profileProvider, providerFields, refresh]);

  const saveCredentials = useCallback(async () => {
    if (!selectedProfileId) {
      setCredentialsError("Select a saved profile for this project.");
      return;
    }
    setCredentialsSaving(true);
    setCredentialsSaved(false);
    setCredentialsError("");
    try {
      await updateCredentials(projectId, { credential_profile_id: selectedProfileId });
      await refresh();
      setAppliedProfileId(selectedProfileId);
      setCredentialsSaved(true);
      window.setTimeout(() => setCredentialsSaved(false), SAVED_BADGE_MS);
    } catch (error: unknown) {
      setCredentialsError(error instanceof Error ? error.message : "Failed to apply profile");
    } finally {
      setCredentialsSaving(false);
    }
  }, [projectId, refresh, selectedProfileId]);

  const removeProfile = useCallback(async (profileId: string) => {
    setProfileDeletingId(profileId);
    setCredentialsError("");
    try {
      await deleteCredentialProfile(profileId);
      await refresh();
      setSelectedProfileId((current) => (current === profileId ? "" : current));
    } catch (error: unknown) {
      setCredentialsError(error instanceof Error ? error.message : "Failed to delete profile");
    } finally {
      setProfileDeletingId(null);
    }
  }, [refresh]);

  return {
    credentialsProvider: fallbackProvider ?? null,
    providerFields,
    credentialProfiles: profiles,
    selectedCredentialProfileId: selectedProfileId,
    setSelectedCredentialProfileId: setSelectedProfileId,
    appliedCredentialProfileId: appliedProfileId,
    appliedCredentialProfile: appliedProfile,
    selectedCredentialProfile: selectedProfile,
    profileName,
    setProfileName,
    profileFields,
    setProfileFields,
    credentialsLoading,
    credentialsSaving,
    credentialsSaved,
    credentialsError,
    missingCredentialFields,
    applyReady,
    profileDeletingId,
    createProfile,
    saveCredentials,
    removeProfile,
  };
}
