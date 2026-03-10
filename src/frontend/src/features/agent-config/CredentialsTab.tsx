import { useEffect, useMemo, useState } from "react";

import { getCredentials, updateCredentials } from "../../api/projects/index";
import { AWS_FIELDS, GCP_FIELDS } from "./constants";

export function CredentialsTab({ projectId }: { projectId: string }) {
  const [provider, setProvider] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    getCredentials(projectId)
      .then((data) => {
        setProvider(data.provider);
        const initial: Record<string, string> = {};
        for (const [key, value] of Object.entries(data.credentials ?? {})) {
          initial[key] = value === "****" ? "" : (value ?? "");
        }
        setFields(initial);
      })
      .catch(() => setError("Failed to load credentials"))
      .finally(() => setLoading(false));
  }, [projectId]);

  const providerFields = useMemo(
    () => (provider === "aws" ? AWS_FIELDS : provider === "gcloud" ? GCP_FIELDS : []),
    [provider],
  );

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSaved(false);

    try {
      const patch: Record<string, string> = {};
      for (const { key } of providerFields) {
        if (fields[key] !== undefined && fields[key] !== "") {
          patch[key] = fields[key];
        }
      }
      await updateCredentials(projectId, patch);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="py-4 text-xs text-ink/40">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="text-xs text-ink/50">Cloud provider:</span>
        {provider ? (
          <span
            className={`rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${
              provider === "aws" ? "bg-orange-100 text-orange-600" : "bg-blue-100 text-blue-600"
            }`}
          >
            {provider === "aws" ? "AWS" : "GCP"}
          </span>
        ) : (
          <span className="text-xs text-ink/40">Not set</span>
        )}
        <span className="ml-auto text-[10px] text-ink/30">(immutable after creation)</span>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}

      {providerFields.length === 0 && (
        <p className="rounded-xl border border-dashed border-black/10 py-8 text-center text-sm text-ink/40">
          No provider configured for this project.
        </p>
      )}

      {providerFields.map(({ key, label, secret, placeholder }) => (
        <div key={key} className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ink/70">{label}</label>
          {key === "gcp_credentials_json" ? (
            <textarea
              className="h-28 w-full resize-none rounded-lg border border-black/10 bg-white px-3 py-2 font-mono text-xs outline-none focus:border-tide/60 focus:ring-1 focus:ring-tide/30"
              placeholder="Paste service account JSON…"
              value={fields[key] ?? ""}
              onChange={(e) => setFields((next) => ({ ...next, [key]: e.target.value }))}
              spellCheck={false}
            />
          ) : (
            <input
              type={secret ? "password" : "text"}
              className="rounded-lg border border-black/10 bg-white px-3 py-2 text-xs outline-none focus:border-tide/60 focus:ring-1 focus:ring-tide/30"
              placeholder={placeholder ?? (secret ? "••••••••" : "")}
              value={fields[key] ?? ""}
              onChange={(e) => setFields((next) => ({ ...next, [key]: e.target.value }))}
              autoComplete="off"
            />
          )}
        </div>
      ))}

      {providerFields.length > 0 && (
        <div className="flex items-center justify-end gap-3 pt-1">
          {saved && <span className="text-xs text-green-600">✓ Saved</span>}
          <button
            className="rounded-lg bg-tide px-4 py-1.5 text-sm text-white hover:bg-tide/80 disabled:opacity-50"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save credentials"}
          </button>
        </div>
      )}
    </div>
  );
}
