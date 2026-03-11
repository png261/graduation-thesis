import { Info, RefreshCw } from "lucide-react";

import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";

interface GraphSidebarProps {
  modules: string[];
  scope: string;
  loading: boolean;
  onScopeChange: (scope: string) => void;
  onRefresh: () => void;
}

function graphScopeButtonClass(active: boolean) {
  return cn(
    "w-full rounded-lg border px-4 py-3 text-left text-xl font-semibold leading-none",
    active ? "border-white/70 bg-white/[0.1] text-white" : "border-white/10 bg-white/[0.03] text-white/80 hover:border-white/25",
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

function GraphSidebarHint() {
  return (
    <div className="flex items-start gap-2 text-lg leading-snug text-white/55">
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      <p>The graph is rendered using your Terraform configuration.</p>
    </div>
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

export function GraphSidebar({ modules, scope, loading, onScopeChange, onRefresh }: GraphSidebarProps) {
  return (
    <aside className="w-[300px] border-r border-white/10 bg-gradient-to-b from-[#14171d] to-[#101319] p-4">
      <h3 className="mb-5 text-3xl font-semibold leading-none text-white/90">Graph View</h3>
      <div className="space-y-3">
        <GraphModulesList modules={modules} scope={scope} onScopeChange={onScopeChange} />
        <GraphSidebarHint />
        <GraphRefreshButton loading={loading} onRefresh={onRefresh} />
      </div>
    </aside>
  );
}
