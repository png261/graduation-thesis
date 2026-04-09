import { ChevronDown, ChevronRight, Info, RefreshCw } from "lucide-react";

import type { OpenTofuCostResult } from "../../../api/projects/index";
import { Button } from "../../../components/ui/button";
import { ScrollArea } from "../../../components/ui/scroll-area";
import { cn } from "../../../lib/utils";

export interface CostsWorkspaceProps {
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
    <button type="button" onClick={onClick} className={cn("flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left", active ? "border-blue-300 bg-blue-50 text-[var(--da-text)]" : "border-[var(--da-border)] bg-[var(--da-panel)] text-[color-mix(in_srgb,var(--da-text)_82%,transparent)] hover:border-blue-200")}>
      <span className={label === "Total" ? "text-2xl font-semibold leading-none" : "text-xl font-semibold leading-none"}>{label}</span>
      <span className={label === "Total" ? "text-2xl font-semibold leading-none" : "text-xl font-medium leading-none"}>
        {label === "Total" ? `${formatMoney(amount, currency)}/mo` : formatMoney(amount, currency)}
      </span>
    </button>
  );
}

export interface CostsWorkspaceSidebarPanelProps {
  data: OpenTofuCostResult | null;
  scope: string;
  onScopeChange: (scope: string) => void;
  className?: string;
}

export function CostsWorkspaceSidebarPanel({ data, scope, onScopeChange, className }: CostsWorkspaceSidebarPanelProps) {
  const view = useCostsWorkspaceViewModel(data);
  return (
    <aside className={cn("h-full bg-gradient-to-b from-[var(--da-elevated)] to-[var(--da-panel)] p-4", className)}>
      <div className="space-y-3">
        {view.moduleOptions.length < 1 ? <div className="rounded-lg border border-[var(--da-border)] bg-[var(--da-panel)] px-4 py-3 text-sm text-[var(--da-muted)]">No modules yet</div> : view.moduleOptions.map((moduleName) => <CostScopeButton key={moduleName} label={moduleName} active={scope === moduleName} amount={view.moduleCostMap.get(moduleName) ?? 0} currency={view.currency} onClick={() => onScopeChange(moduleName)} />)}
        <CostScopeButton label="Total" active={scope === "all"} amount={data?.total_monthly_cost ?? 0} currency={view.currency} onClick={() => onScopeChange("all")} />
        <div className="flex items-start gap-2 text-sm leading-snug text-[var(--da-muted)]">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Costs are calculated using your Terraform configuration.</p>
        </div>
      </div>
    </aside>
  );
}

function CostsTopBar({ loading, onRefresh }: { loading: boolean; onRefresh: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--da-border)] px-4 py-3">
      <Button variant="outline" size="sm" className="gap-1.5" onClick={onRefresh} disabled={loading}>
        <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        Refresh
      </Button>
    </div>
  );
}

function CostsErrorBanner({ error }: { error: string }) {
  if (!error) return null;
  return <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-700">{error}</div>;
}

function CostsTableHeader() {
  return (
    <div className="grid grid-cols-[minmax(0,1.6fr)_160px_160px_180px] border-b border-[var(--da-border)] px-4 py-3 text-xs font-medium uppercase tracking-[0.12em] text-[var(--da-muted)]">
      <span>Resource</span>
      <span>Quantity</span>
      <span>Units</span>
      <span className="text-right">Monthly Cost</span>
    </div>
  );
}

function ResourceComponentRow({ component, currency }: { component: CostComponent; currency: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1.6fr)_160px_160px_180px] text-xs text-[color-mix(in_srgb,var(--da-text)_72%,transparent)]">
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
    <div className="border-t border-[var(--da-border)] bg-[var(--da-elevated)] px-4 py-2">
      {resource.components.length < 1 ? <p className="text-xs text-[var(--da-muted)]">No cost components available.</p> : <div className="space-y-1.5">{resource.components.map((component) => <ResourceComponentRow key={component.id} component={component} currency={currency} />)}</div>}
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
    <div className="border-t border-[var(--da-border)]">
      <button type="button" onClick={onToggle} className="grid w-full grid-cols-[minmax(0,1.6fr)_160px_160px_180px] items-center px-4 py-2.5 text-left text-sm text-[var(--da-text)] hover:bg-[var(--da-elevated)]">
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
    <div className="border-b border-[var(--da-border)]">
      <div className="grid grid-cols-[minmax(0,1.6fr)_160px_160px_180px] bg-[var(--da-elevated)] px-4 py-3 text-sm font-semibold text-[var(--da-text)]">
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
  if (loading) return <div className="px-4 py-8 text-sm text-[var(--da-muted)]">Calculating costs...</div>;
  if (resourcesCount < 1) return <div className="px-4 py-8 text-sm text-[var(--da-muted)]">No cost data yet.</div>;
  return <div>{[...groupedResources.entries()].map(([moduleName, resources]) => <ModuleResourcesSection key={moduleName} moduleName={moduleName} resources={resources} currency={currency} moduleCostMap={moduleCostMap} expandedResourceIds={expandedResourceIds} onToggleResource={onToggleResource} />)}</div>;
}

function CostsFootnote() {
  return <div className="border-t border-[var(--da-border)] px-4 py-3 text-xs text-[var(--da-muted)]">Not all Terraform resources are supported for cost analysis. Check Infracost docs for full support coverage.</div>;
}

function CostsWarnings({ warnings }: { warnings: string[] }) {
  if (warnings.length < 1) return null;
  return <div className="space-y-1 px-4 pb-4 text-xs text-amber-700">{warnings.map((warning, index) => <p key={`${index}-${warning.slice(0, 12)}`}>{warning}</p>)}</div>;
}

function CostsModuleFooter({ moduleOptions }: { moduleOptions: string[] }) {
  if (moduleOptions.length < 1) return null;
  return <div className="border-t border-[var(--da-border)] px-4 py-2 text-xs text-[var(--da-muted)]">Available modules: {moduleOptions.join(", ")}</div>;
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

export interface CostsWorkspaceMainPanelProps {
  data: OpenTofuCostResult | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
  expandedResourceIds: Set<string>;
  onToggleResource: (resourceId: string) => void;
  className?: string;
}

export function CostsWorkspaceMainPanel({
  data,
  loading,
  error,
  onRefresh,
  expandedResourceIds,
  onToggleResource,
  className,
}: CostsWorkspaceMainPanelProps) {
  const view = useCostsWorkspaceViewModel(data);
  return (
    <section className={cn("min-w-0 flex-1 bg-[var(--da-bg)]", className)}>
      <div className="flex h-full min-h-0 flex-col">
        <CostsTopBar loading={loading} onRefresh={onRefresh} />
        <CostsErrorBanner error={error} />
        <CostsTableHeader />
        <ScrollArea className="min-h-0 flex-1">
          <CostsTableBody loading={loading} resourcesCount={view.resources.length} groupedResources={view.groupedResources} currency={view.currency} moduleCostMap={view.moduleCostMap} expandedResourceIds={expandedResourceIds} onToggleResource={onToggleResource} />
          <CostsFootnote />
          <CostsWarnings warnings={view.warnings} />
        </ScrollArea>
        <CostsModuleFooter moduleOptions={view.moduleOptions} />
      </div>
    </section>
  );
}

function CostsWorkspaceLayout({
  props,
}: {
  props: CostsWorkspaceProps;
}) {
  return (
    <div className="flex h-full min-h-0 bg-[var(--da-bg)]">
      <CostsWorkspaceSidebarPanel data={props.data} scope={props.scope} onScopeChange={props.onScopeChange} className="w-[300px] shrink-0 border-r border-[var(--da-border)]" />
      <CostsWorkspaceMainPanel data={props.data} loading={props.loading} error={props.error} onRefresh={props.onRefresh} expandedResourceIds={props.expandedResourceIds} onToggleResource={props.onToggleResource} />
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
  return <CostsWorkspaceLayout props={{ data, loading, error, scope, onScopeChange, onRefresh, expandedResourceIds, onToggleResource }} />;
}
