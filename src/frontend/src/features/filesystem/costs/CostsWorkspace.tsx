import { ChevronDown, ChevronRight, Info, RefreshCw } from "lucide-react";

import type { OpenTofuCostResult } from "../../../api/projects/index";
import { Button } from "../../../components/ui/button";
import { ScrollArea } from "../../../components/ui/scroll-area";
import { cn } from "../../../lib/utils";

interface CostsWorkspaceProps {
  data: OpenTofuCostResult | null;
  loading: boolean;
  error: string;
  scope: string;
  onScopeChange: (scope: string) => void;
  onRefresh: () => void;
  expandedResourceIds: Set<string>;
  onToggleResource: (resourceId: string) => void;
}

type CostResource = OpenTofuCostResult["resources"][number];
type CostComponent = CostResource["components"][number];

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0);
}

function formatQuantity(value: number) {
  return value === 0 ? "0" : value || "-";
}

function buildModuleCostMap(modules: OpenTofuCostResult["modules"]) {
  return new Map(modules.map((module) => [module.name, module.monthly_cost]));
}

function groupResourcesByModule(resources: OpenTofuCostResult["resources"]) {
  const grouped = new Map<string, OpenTofuCostResult["resources"]>();
  for (const resource of resources) {
    const current = grouped.get(resource.module);
    if (current) current.push(resource);
    else grouped.set(resource.module, [resource]);
  }
  return grouped;
}

function CostScopeButton({
  label,
  active,
  amount,
  currency,
  onClick,
}: {
  label: string;
  active: boolean;
  amount: number;
  currency: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={cn("flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left", active ? "border-white/70 bg-white/[0.08] text-white" : "border-white/10 bg-white/[0.03] text-white/80 hover:border-white/25")}>
      <span className={label === "Total" ? "text-2xl font-semibold leading-none" : "text-xl font-semibold leading-none"}>{label}</span>
      <span className={label === "Total" ? "text-2xl font-semibold leading-none" : "text-xl font-medium leading-none"}>
        {label === "Total" ? `${formatMoney(amount, currency)}/mo` : formatMoney(amount, currency)}
      </span>
    </button>
  );
}

function CostsSidebar({
  moduleOptions,
  moduleCostMap,
  scope,
  totalMonthlyCost,
  currency,
  onScopeChange,
}: {
  moduleOptions: string[];
  moduleCostMap: Map<string, number>;
  scope: string;
  totalMonthlyCost: number;
  currency: string;
  onScopeChange: (scope: string) => void;
}) {
  return (
    <aside className="w-[300px] border-r border-white/10 bg-gradient-to-b from-[#14171d] to-[#101319] p-4">
      <h3 className="mb-5 text-3xl font-semibold leading-none text-white/90">Cost Summary</h3>
      <div className="space-y-3">
        {moduleOptions.length < 1 ? <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/60">No modules yet</div> : moduleOptions.map((moduleName) => <CostScopeButton key={moduleName} label={moduleName} active={scope === moduleName} amount={moduleCostMap.get(moduleName) ?? 0} currency={currency} onClick={() => onScopeChange(moduleName)} />)}
        <CostScopeButton label="Total" active={scope === "all"} amount={totalMonthlyCost} currency={currency} onClick={() => onScopeChange("all")} />
        <div className="flex items-start gap-2 text-sm leading-snug text-white/55">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Costs are calculated using your Terraform configuration.</p>
        </div>
      </div>
    </aside>
  );
}

function CostsTopBar({ loading, onRefresh }: { loading: boolean; onRefresh: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
      <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs font-medium text-white/75">v0.0.1</span>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={onRefresh} disabled={loading}>
        <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        Refresh
      </Button>
    </div>
  );
}

function CostsErrorBanner({ error }: { error: string }) {
  if (!error) return null;
  return <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-200">{error}</div>;
}

function CostsTableHeader() {
  return (
    <div className="grid grid-cols-[minmax(0,1.6fr)_160px_160px_180px] border-b border-white/10 px-4 py-3 text-xs font-medium uppercase tracking-[0.12em] text-white/60">
      <span>Resource</span>
      <span>Quantity</span>
      <span>Units</span>
      <span className="text-right">Monthly Cost</span>
    </div>
  );
}

function ResourceComponentRow({ component, currency }: { component: CostComponent; currency: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1.6fr)_160px_160px_180px] text-xs text-white/70">
      <span className="truncate pl-6">{component.name}</span>
      <span>{formatQuantity(component.monthly_quantity)}</span>
      <span>{component.unit || "-"}</span>
      <span className="text-right">{formatMoney(component.monthly_cost, currency)}</span>
    </div>
  );
}

function ResourceDetails({
  resource,
  expanded,
  currency,
}: {
  resource: CostResource;
  expanded: boolean;
  currency: string;
}) {
  if (!expanded) return null;
  return (
    <div className="border-t border-white/5 bg-white/[0.02] px-4 py-2">
      {resource.components.length < 1 ? <p className="text-xs text-white/50">No cost components available.</p> : <div className="space-y-1.5">{resource.components.map((component) => <ResourceComponentRow key={component.id} component={component} currency={currency} />)}</div>}
    </div>
  );
}

function ResourceRow({
  resource,
  expanded,
  currency,
  onToggle,
}: {
  resource: CostResource;
  expanded: boolean;
  currency: string;
  onToggle: () => void;
}) {
  return (
    <div className="border-t border-white/5">
      <button type="button" onClick={onToggle} className="grid w-full grid-cols-[minmax(0,1.6fr)_160px_160px_180px] items-center px-4 py-2.5 text-left text-sm text-white/90 hover:bg-white/[0.03]">
        <span className="flex items-center gap-2 truncate">{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}<span className="truncate">{resource.resource_type}.{resource.resource_name}</span></span>
        <span>{formatQuantity(resource.quantity)}</span>
        <span>{resource.unit || "-"}</span>
        <span className="text-right">{formatMoney(resource.monthly_cost, currency)}</span>
      </button>
      <ResourceDetails resource={resource} expanded={expanded} currency={currency} />
    </div>
  );
}

function ModuleResourcesSection({
  moduleName,
  resources,
  currency,
  moduleCostMap,
  expandedResourceIds,
  onToggleResource,
}: {
  moduleName: string;
  resources: CostResource[];
  currency: string;
  moduleCostMap: Map<string, number>;
  expandedResourceIds: Set<string>;
  onToggleResource: (resourceId: string) => void;
}) {
  return (
    <div className="border-b border-white/10">
      <div className="grid grid-cols-[minmax(0,1.6fr)_160px_160px_180px] bg-white/[0.02] px-4 py-3 text-sm font-semibold text-white/90">
        <span>{moduleName}</span><span /><span />
        <span className="text-right">{formatMoney(moduleCostMap.get(moduleName) ?? 0, currency)}</span>
      </div>
      {resources.map((resource) => <ResourceRow key={resource.id} resource={resource} expanded={expandedResourceIds.has(resource.id)} currency={currency} onToggle={() => onToggleResource(resource.id)} />)}
    </div>
  );
}

function CostsTableBody({
  loading,
  resourcesCount,
  groupedResources,
  currency,
  moduleCostMap,
  expandedResourceIds,
  onToggleResource,
}: {
  loading: boolean;
  resourcesCount: number;
  groupedResources: Map<string, CostResource[]>;
  currency: string;
  moduleCostMap: Map<string, number>;
  expandedResourceIds: Set<string>;
  onToggleResource: (resourceId: string) => void;
}) {
  if (loading) return <div className="px-4 py-8 text-sm text-white/60">Calculating costs...</div>;
  if (resourcesCount < 1) return <div className="px-4 py-8 text-sm text-white/60">No cost data yet.</div>;
  return <div>{[...groupedResources.entries()].map(([moduleName, resources]) => <ModuleResourcesSection key={moduleName} moduleName={moduleName} resources={resources} currency={currency} moduleCostMap={moduleCostMap} expandedResourceIds={expandedResourceIds} onToggleResource={onToggleResource} />)}</div>;
}

function CostsFootnote() {
  return <div className="border-t border-white/10 px-4 py-3 text-xs text-white/50">Not all Terraform resources are supported for cost analysis. Check Infracost docs for full support coverage.</div>;
}

function CostsWarnings({ warnings }: { warnings: string[] }) {
  if (warnings.length < 1) return null;
  return <div className="space-y-1 px-4 pb-4 text-xs text-amber-200/90">{warnings.map((warning, index) => <p key={`${index}-${warning.slice(0, 12)}`}>{warning}</p>)}</div>;
}

function CostsModuleFooter({ moduleOptions }: { moduleOptions: string[] }) {
  if (moduleOptions.length < 1) return null;
  return <div className="border-t border-white/10 px-4 py-2 text-xs text-white/40">Available modules: {moduleOptions.join(", ")}</div>;
}

function useCostsWorkspaceViewModel(data: OpenTofuCostResult | null) {
  const currency = data?.currency || "USD";
  const modules = data?.modules ?? [];
  const moduleOptions = data?.available_modules ?? [];
  const resources = data?.resources ?? [];
  const warnings = data?.warnings ?? [];
  const moduleCostMap = buildModuleCostMap(modules);
  const groupedResources = groupResourcesByModule(resources);
  return { currency, moduleOptions, resources, warnings, moduleCostMap, groupedResources };
}

function CostsWorkspaceLayout({
  props,
  view,
}: {
  props: CostsWorkspaceProps;
  view: ReturnType<typeof useCostsWorkspaceViewModel>;
}) {
  return (
    <div className="flex h-full min-h-0 bg-[#0a0d12]">
      <CostsSidebar moduleOptions={view.moduleOptions} moduleCostMap={view.moduleCostMap} scope={props.scope} totalMonthlyCost={props.data?.total_monthly_cost ?? 0} currency={view.currency} onScopeChange={props.onScopeChange} />
      <section className="min-w-0 flex-1 bg-[#07090d]">
        <CostsTopBar loading={props.loading} onRefresh={props.onRefresh} />
        <CostsErrorBanner error={props.error} />
        <CostsTableHeader />
        <ScrollArea className="h-[calc(100%-7.5rem)]">
          <CostsTableBody loading={props.loading} resourcesCount={view.resources.length} groupedResources={view.groupedResources} currency={view.currency} moduleCostMap={view.moduleCostMap} expandedResourceIds={props.expandedResourceIds} onToggleResource={props.onToggleResource} />
          <CostsFootnote />
          <CostsWarnings warnings={view.warnings} />
        </ScrollArea>
        <CostsModuleFooter moduleOptions={view.moduleOptions} />
      </section>
    </div>
  );
}

export function CostsWorkspace({
  data,
  loading,
  error,
  scope,
  onScopeChange,
  onRefresh,
  expandedResourceIds,
  onToggleResource,
}: CostsWorkspaceProps) {
  const view = useCostsWorkspaceViewModel(data);
  return <CostsWorkspaceLayout props={{ data, loading, error, scope, onScopeChange, onRefresh, expandedResourceIds, onToggleResource }} view={view} />;
}
