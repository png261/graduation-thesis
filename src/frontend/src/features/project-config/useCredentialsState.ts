import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import { getCredentials, updateCredentials } from "../../api/projects/index";
import { AWS_FIELDS, GCP_FIELDS, type ProviderField } from "./constants";

const CREDENTIALS_TIMEOUT_MS = 10_000;
const SAVED_BADGE_MS = 2_000;

function toInitialCredentialFields(credentials: Record<string, string>) {
  const initial: Record<string, string> = {};
  for (const [key, value] of Object.entries(credentials)) {
    initial[key] = value === "****" ? "" : value ?? "";
  }
  return initial;
}

export function normalizeCredentialsResponse(data: {
  provider: string | null;
  credentials?: Record<string, string> | null;
  missing_fields?: string[] | null;
  apply_ready?: boolean | null;
}) {
  return {
    provider: data.provider,
    credentialFields: toInitialCredentialFields(data.credentials ?? {}),
    missingCredentialFields: Array.isArray(data.missing_fields) ? data.missing_fields.map((field) => String(field)) : [],
    applyReady: Boolean(data.apply_ready),
  };
}

function toLoadCredentialsError(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") {
    return "Loading credentials timed out. Check API server and try again.";
  }
  return error instanceof Error ? error.message : "Failed to load credentials";
}

function resolveProviderFields(provider: string | null): ProviderField[] {
  if (provider === "aws") return AWS_FIELDS;
  if (provider === "gcloud") return GCP_FIELDS;
  return [];
}

export function buildCredentialPatch(providerFields: ProviderField[], credentialFields: Record<string, string>) {
  const patch: Record<string, string> = {};
  for (const { key } of providerFields) {
    const value = credentialFields[key];
    if (value !== undefined && value !== "") patch[key] = value;
  }
  return patch;
}

function initializeCredentialsLoad(
  fallbackProvider: string | null | undefined,
  setCredentialsLoading: Dispatch<SetStateAction<boolean>>,
  setCredentialsError: Dispatch<SetStateAction<string>>,
  setCredentialsProvider: Dispatch<SetStateAction<string | null>>,
) {
  setCredentialsLoading(true);
  setCredentialsError("");
  setCredentialsProvider((previous) => previous ?? fallbackProvider ?? null);
}

function applyCredentialsResponse(
  active: boolean,
  data: {
    provider: string | null;
    credentials?: Record<string, string> | null;
    missing_fields?: string[] | null;
    apply_ready?: boolean | null;
  },
  setCredentialsProvider: Dispatch<SetStateAction<string | null>>,
  setCredentialFields: Dispatch<SetStateAction<Record<string, string>>>,
  setMissingCredentialFields: Dispatch<SetStateAction<string[]>>,
  setApplyReady: Dispatch<SetStateAction<boolean>>,
) {
  if (!active) return;
  const normalized = normalizeCredentialsResponse(data);
  setCredentialsProvider(normalized.provider);
  setCredentialFields(normalized.credentialFields);
  setMissingCredentialFields(normalized.missingCredentialFields);
  setApplyReady(normalized.applyReady);
}

function applyCredentialsError(
  active: boolean,
  error: unknown,
  setCredentialsError: Dispatch<SetStateAction<string>>,
) {
  if (!active) return;
  setCredentialsError(toLoadCredentialsError(error));
}

function finalizeCredentialsLoad(
  active: boolean,
  timeout: number,
  setCredentialsLoading: Dispatch<SetStateAction<boolean>>,
) {
  if (!active) return;
  window.clearTimeout(timeout);
  setCredentialsLoading(false);
}

function useLoadCredentialsEffect(args: {
  projectId: string;
  fallbackProvider: string | null | undefined;
  setCredentialsProvider: Dispatch<SetStateAction<string | null>>;
  setCredentialFields: Dispatch<SetStateAction<Record<string, string>>>;
  setMissingCredentialFields: Dispatch<SetStateAction<string[]>>;
  setApplyReady: Dispatch<SetStateAction<boolean>>;
  setCredentialsLoading: Dispatch<SetStateAction<boolean>>;
  setCredentialsError: Dispatch<SetStateAction<string>>;
}) {
  const {
    projectId,
    fallbackProvider,
    setCredentialsProvider,
    setCredentialFields,
    setMissingCredentialFields,
    setApplyReady,
    setCredentialsLoading,
    setCredentialsError,
  } = args;
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), CREDENTIALS_TIMEOUT_MS);
    initializeCredentialsLoad(fallbackProvider, setCredentialsLoading, setCredentialsError, setCredentialsProvider);
    getCredentials(projectId, { signal: controller.signal })
      .then((data) =>
        applyCredentialsResponse(
          active,
          data,
          setCredentialsProvider,
          setCredentialFields,
          setMissingCredentialFields,
          setApplyReady,
        ),
      )
      .catch((error: unknown) => applyCredentialsError(active, error, setCredentialsError))
      .finally(() => finalizeCredentialsLoad(active, timeout, setCredentialsLoading));
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [
    fallbackProvider,
    projectId,
    setApplyReady,
    setCredentialFields,
    setCredentialsError,
    setCredentialsLoading,
    setCredentialsProvider,
    setMissingCredentialFields,
  ]);
}

function useSaveCredentialsAction(args: {
  projectId: string;
  providerFields: ProviderField[];
  credentialFields: Record<string, string>;
  setCredentialFields: Dispatch<SetStateAction<Record<string, string>>>;
  setCredentialsProvider: Dispatch<SetStateAction<string | null>>;
  setMissingCredentialFields: Dispatch<SetStateAction<string[]>>;
  setApplyReady: Dispatch<SetStateAction<boolean>>;
  setCredentialsSaving: Dispatch<SetStateAction<boolean>>;
  setCredentialsSaved: Dispatch<SetStateAction<boolean>>;
  setCredentialsError: Dispatch<SetStateAction<string>>;
}) {
  return async () => {
    args.setCredentialsSaving(true);
    args.setCredentialsSaved(false);
    args.setCredentialsError("");
    try {
      const patch = buildCredentialPatch(args.providerFields, args.credentialFields);
      await updateCredentials(args.projectId, patch);
      const data = await getCredentials(args.projectId);
      const normalized = normalizeCredentialsResponse(data);
      args.setCredentialsProvider(normalized.provider);
      args.setCredentialFields(normalized.credentialFields);
      args.setMissingCredentialFields(normalized.missingCredentialFields);
      args.setApplyReady(normalized.applyReady);
      args.setCredentialsSaved(true);
      window.setTimeout(() => args.setCredentialsSaved(false), SAVED_BADGE_MS);
    } catch (error: unknown) {
      args.setCredentialsError(error instanceof Error ? error.message : "Failed to save credentials");
    } finally {
      args.setCredentialsSaving(false);
    }
  };
}

export function useCredentialsState(projectId: string, fallbackProvider: string | null | undefined) {
  const [credentialsProvider, setCredentialsProvider] = useState<string | null>(fallbackProvider ?? null);
  const [credentialFields, setCredentialFields] = useState<Record<string, string>>({});
  const [missingCredentialFields, setMissingCredentialFields] = useState<string[]>([]);
  const [applyReady, setApplyReady] = useState(false);
  const [credentialsLoading, setCredentialsLoading] = useState(true);
  const [credentialsSaving, setCredentialsSaving] = useState(false);
  const [credentialsSaved, setCredentialsSaved] = useState(false);
  const [credentialsError, setCredentialsError] = useState("");
  useLoadCredentialsEffect({
    projectId,
    fallbackProvider,
    setCredentialsProvider,
    setCredentialFields,
    setMissingCredentialFields,
    setApplyReady,
    setCredentialsLoading,
    setCredentialsError,
  });
  const effectiveProvider = credentialsProvider ?? fallbackProvider ?? null;
  const providerFields = useMemo(() => resolveProviderFields(effectiveProvider), [effectiveProvider]);
  const saveCredentials = useSaveCredentialsAction({
    projectId,
    providerFields,
    credentialFields,
    setCredentialFields,
    setCredentialsProvider,
    setMissingCredentialFields,
    setApplyReady,
    setCredentialsSaving,
    setCredentialsSaved,
    setCredentialsError,
  });
  return {
    credentialsProvider: effectiveProvider,
    credentialFields,
    setCredentialFields,
    credentialsLoading,
    credentialsSaving,
    credentialsSaved,
    credentialsError,
    missingCredentialFields,
    applyReady,
    providerFields,
    saveCredentials,
  };
}
