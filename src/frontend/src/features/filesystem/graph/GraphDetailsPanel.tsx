import { Globe, X } from "lucide-react";

import type { OpenTofuGraphNode } from "../../../api/projects/index";

export function GraphDetailsPanel({
  details,
  onClose,
}: {
  details: OpenTofuGraphNode;
  onClose: () => void;
}) {
  return (
    <aside className="absolute bottom-0 right-0 top-0 z-20 w-[330px] border-l border-white/10 bg-[#06080c]">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div className="flex items-center gap-2 text-lg font-semibold text-white">
          <Globe className="h-5 w-5 text-white/80" />
          Environment Details
        </div>
        <button
          type="button"
          className="text-white/60 hover:text-white"
          onClick={onClose}
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="space-y-4 px-5 py-4 text-sm text-white/85">
        <div className="rounded-lg bg-white/[0.05] px-4 py-3 text-xl font-semibold leading-none">
          {details.module}
        </div>

        <div>
          <p className="text-xs uppercase tracking-[0.12em] text-white/50">Provider</p>
          <p className="mt-1 text-lg font-medium uppercase">{String(details.meta?.provider || "unknown")}</p>
        </div>

        <div>
          <p className="text-xs uppercase tracking-[0.12em] text-white/50">Region</p>
          <p className="mt-1 text-lg font-medium">{String(details.meta?.region || "unknown")}</p>
        </div>

        <div className="border-t border-white/10 pt-4">
          <p className="text-xs uppercase tracking-[0.12em] text-white/50">Node ID</p>
          <p className="mt-1 break-all font-mono text-base text-white/85">{details.id}</p>
        </div>

        {details.kind === "resource" && (
          <>
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-white/50">Address</p>
              <p className="mt-1 break-all font-mono text-sm text-white/80">{details.address || "-"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-white/50">Resource Type</p>
              <p className="mt-1 text-sm text-white/85">{details.resource_type || "-"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-white/50">Dependencies</p>
              <p className="mt-1 text-sm text-white/85">
                in: {String(details.meta?.in_degree ?? 0)} | out: {String(details.meta?.out_degree ?? 0)}
              </p>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
