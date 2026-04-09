import { Info, RefreshCw } from "lucide-react";

import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";

interface GraphSidebarProps {
  modules: string[];
  scope: string;
  loading: boolean;
  onScopeChange: (scope: string) => void;
  onRefresh: () => void;
  className?: string;
}

function graphScopeButtonClass(active: boolean) {
  return cn(
    "w-full rounded-lg border px-4 py-3 text-left text-xl font-semibold leading-none",
    active ? "border-blue-300 bg-blue-50 text-[var(--da-text)]" : "border-[var(--da-border)] bg-[var(--da-panel)] text-[color-mix(in_srgb,var(--da-text)_82%,transparent)] hover:border-blue-200",
  );
}

function GraphScopeButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={graphScopeButtonClass(active)}>
      {label}
    </button>
  );
}

function GraphModulesList({ modules, scope, onScopeChange }: { modules: string[]; scope: string; onScopeChange: (scope: string) => void }) {
  return (
    <>
      {modules.map((moduleName) => (
        <GraphScopeButton key={moduleName} label={moduleName} active={scope === moduleName} onClick={() => onScopeChange(moduleName)} />
      ))}
      <GraphScopeButton label="All" active={scope === "all"} onClick={() => onScopeChange("all")} />
    </>
  );
}

function GraphRefreshButton({ loading, onRefresh }: { loading: boolean; onRefresh: () => void }) {
  return (
    <Button variant="outline" size="sm" className="mt-2 w-full justify-center gap-1.5" onClick={onRefresh} disabled={loading}>
      <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
      Refresh
    </Button>
  );
}

export function GraphSidebar({ modules, scope, loading, onScopeChange, onRefresh, className }: GraphSidebarProps) {
  return (
    <aside className={cn("h-full w-[300px] border-r border-[var(--da-border)] bg-gradient-to-b from-[var(--da-elevated)] to-[var(--da-panel)] p-4", className)}>
      <div className="space-y-3">
        <GraphModulesList modules={modules} scope={scope} onScopeChange={onScopeChange} />
        <GraphRefreshButton loading={loading} onRefresh={onRefresh} />
      </div>
    </aside>
  );
}
