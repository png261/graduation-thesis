import { useState } from "react";

import { initTemplate } from "../../api/projects/index";
import { TEMPLATES } from "./constants";

export function TemplatesTab({
  projectId,
  onInit,
}: {
  projectId: string;
  onInit: () => void;
}) {
  const [loading, setLoading] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState("");

  const apply = async (templateId: "opentofu") => {
    if (!confirm("This will add skills and scaffold project directories. Continue?")) return;

    setLoading(templateId);
    setError("");
    try {
      await initTemplate(projectId, templateId);
      setDone(templateId);
      onInit();
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "Failed to apply template");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-ink/50">
        Templates add <strong className="text-ink/80">Skills</strong> and directories for a specific use-case.
        Sub-agents listed below are always available to all projects.
      </p>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}

      {TEMPLATES.map((template) => (
        <div key={template.id} className="rounded-xl border border-black/8 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 font-medium text-ink">
                <span>{template.icon}</span>
                {template.label}
              </p>
              <p className="mt-1 text-xs text-ink/50">{template.description}</p>
              <ul className="mt-2 space-y-0.5">
                {template.details.map((detail) => (
                  <li key={detail} className="flex items-center gap-1.5 text-xs text-ink/60">
                    <span className="text-tide">✓</span> {detail}
                  </li>
                ))}
              </ul>
            </div>
            <button
              className="shrink-0 rounded-lg bg-tide px-3 py-1.5 text-sm text-white hover:bg-tide/80 disabled:opacity-50"
              disabled={loading === template.id}
              onClick={() => apply(template.id)}
            >
              {loading === template.id ? "Applying…" : done === template.id ? "✓ Applied" : "Apply"}
            </button>
          </div>
        </div>
      ))}

      <div className="rounded-xl border border-dashed border-black/10 p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink/40">
          Always-on Sub-agents
        </p>
        {[
          ["opentofu-architect", "Designs infrastructure: resources, variables, outputs, providers"],
          ["opentofu-coder", "Writes complete HCL files to disk (main.tf, variables.tf, outputs.tf …)"],
          ["opentofu-reviewer", "Reviews code for correctness, security issues, and completeness"],
        ].map(([name, description]) => (
          <div key={name} className="mt-2 flex items-start gap-2">
            <code className="shrink-0 rounded bg-tide/10 px-1.5 py-0.5 text-xs text-tide">{name}</code>
            <p className="text-xs text-ink/50">{description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
