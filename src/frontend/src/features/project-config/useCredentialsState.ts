import { useEffect, useMemo, useState } from "react";

import { getCredentials, updateCredentials } from "../../api/projects/index";
import { AWS_FIELDS, GCP_FIELDS } from "./constants";

const CREDENTIALS_TIMEOUT_MS = 10_000;

export function useCredentialsState(projectId: string, fallbackProvider: string | null | undefined) {
  const [credentialsProvider, setCredentialsProvider] = useState<string | null>(
    fallbackProvider ?? null,
  );
  const [credentialFields, setCredentialFields] = useState<Record<string, string>>({});
  const [credentialsLoading, setCredentialsLoading] = useState(true);
  const [credentialsSaving, setCredentialsSaving] = useState(false);
  const [credentialsSaved, setCredentialsSaved] = useState(false);
  const [credentialsError, setCredentialsError] = useState("");

  useEffect(() => {
    let active = true;

    setCredentialsLoading(true);
    setCredentialsError("");
    setCredentialsProvider((prev) => prev ?? fallbackProvider ?? null);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), CREDENTIALS_TIMEOUT_MS);

    getCredentials(projectId, { signal: controller.signal })
      .then((data) => {
        if (!active) return;
        setCredentialsProvider(data.provider);
        const initial: Record<string, string> = {};
        for (const [key, value] of Object.entries(data.credentials ?? {})) {
          initial[key] = value === "****" ? "" : value ?? "";
        }
        setCredentialFields(initial);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof Error && error.name === "AbortError") {
          setCredentialsError("Loading credentials timed out. Check API server and try again.");
          return;
        }
        setCredentialsError(error instanceof Error ? error.message : "Failed to load credentials");
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
  }, [projectId, fallbackProvider]);

  const effectiveProvider = credentialsProvider ?? fallbackProvider ?? null;

  const providerFields = useMemo(
    () => (effectiveProvider === "aws" ? AWS_FIELDS : effectiveProvider === "gcloud" ? GCP_FIELDS : []),
    [effectiveProvider],
  );

  const saveCredentials = async () => {
    setCredentialsSaving(true);
    setCredentialsSaved(false);
    setCredentialsError("");

    try {
      const patch: Record<string, string> = {};
      for (const { key } of providerFields) {
        if (credentialFields[key] !== undefined && credentialFields[key] !== "") {
          patch[key] = credentialFields[key];
        }
      }
      await updateCredentials(projectId, patch);
      setCredentialsSaved(true);
      setTimeout(() => setCredentialsSaved(false), 2000);
    } catch (error: unknown) {
      setCredentialsError(error instanceof Error ? error.message : "Failed to save credentials");
    } finally {
      setCredentialsSaving(false);
    }
  };

  return {
    credentialsProvider: effectiveProvider,
    credentialFields,
    setCredentialFields,
    credentialsLoading,
    credentialsSaving,
    credentialsSaved,
    credentialsError,
    providerFields,
    saveCredentials,
  };
}
