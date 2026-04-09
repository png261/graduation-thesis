import { Globe, X } from "lucide-react";

import type { OpenTofuGraphNode } from "../../../api/projects/index";

function GraphDetailsHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--da-border)] px-5 py-4">
      <div className="flex items-center gap-2 text-lg font-semibold text-[var(--da-text)]">
        <Globe className="h-5 w-5 text-[var(--da-accent)]" />
        Environment Details
      </div>
      <button type="button" className="text-[var(--da-muted)] hover:text-[var(--da-text)]" onClick={onClose}>
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}

function GraphMetaField({ label, value, monospace = false }: { label: string; value: string; monospace?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.12em] text-[var(--da-muted)]">{label}</p>
      <p className={monospace ? "mt-1 break-all font-mono text-sm text-[color-mix(in_srgb,var(--da-text)_82%,transparent)]" : "mt-1 text-sm text-[var(--da-text)]"}>{value}</p>
    </div>
  );
}

function ResourceDetails({ details }: { details: OpenTofuGraphNode }) {
  if (details.kind !== "resource") return null;
  return (
    <>
      <GraphMetaField label="Address" value={details.address || "-"} monospace />
      <GraphMetaField label="Resource Type" value={details.resource_type || "-"} />
      <GraphMetaField label="Dependencies" value={`in: ${String(details.meta?.in_degree ?? 0)} | out: ${String(details.meta?.out_degree ?? 0)}`} />
    </>
  );
}

function GraphBaseDetails({ details }: { details: OpenTofuGraphNode }) {
  return (
    <>
      <div className="rounded-lg bg-[var(--da-elevated)] px-4 py-3 text-xl font-semibold leading-none text-[var(--da-text)]">{details.module}</div>
      <GraphMetaField label="Provider" value={String(details.meta?.provider || "unknown").toUpperCase()} />
      <GraphMetaField label="Region" value={String(details.meta?.region || "unknown")} />
      <div className="border-t border-[var(--da-border)] pt-4">
        <GraphMetaField label="Node ID" value={details.id} monospace />
      </div>
    </>
  );
}

export function GraphDetailsPanel({ details, onClose }: { details: OpenTofuGraphNode; onClose: () => void }) {
  return (
    <aside className="absolute bottom-0 right-0 top-0 z-20 w-[330px] border-l border-[var(--da-border)] bg-[var(--da-panel)] shadow-[-8px_0_24px_rgba(15,23,42,0.08)]">
      <GraphDetailsHeader onClose={onClose} />
      <div className="space-y-4 px-5 py-4 text-sm text-[color-mix(in_srgb,var(--da-text)_85%,transparent)]">
        <GraphBaseDetails details={details} />
        <ResourceDetails details={details} />
      </div>
    </aside>
  );
}
