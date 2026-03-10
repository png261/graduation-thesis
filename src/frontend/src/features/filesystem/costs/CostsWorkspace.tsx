import { ChevronDown, ChevronRight, Info, RefreshCw } from "lucide-react";

import type { OpenTofuCostResult } from "../../../api/projects/index";
import { Button } from "../../../components/ui/button";
import { ScrollArea } from "../../../components/ui/scroll-area";
import { cn } from "../../../lib/utils";

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount || 0);
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
}: {
  data: OpenTofuCostResult | null;
  loading: boolean;
  error: string;
  scope: string;
  onScopeChange: (scope: string) => void;
  onRefresh: () => void;
  expandedResourceIds: Set<string>;
  onToggleResource: (resourceId: string) => void;
}) {
  const currency = data?.currency || "USD";
  const modules = data?.modules ?? [];
  const moduleOptions = data?.available_modules ?? [];
  const moduleCostMap = new Map(modules.map((module) => [module.name, module.monthly_cost]));

  const groupedResources = new Map<string, OpenTofuCostResult["resources"]>();
  for (const resource of data?.resources ?? []) {
    const key = resource.module;
    if (!groupedResources.has(key)) groupedResources.set(key, []);
    groupedResources.get(key)!.push(resource);
  }

  return (
    <div className="flex h-full min-h-0 bg-[#0a0d12]">
      <aside className="w-[300px] border-r border-white/10 bg-gradient-to-b from-[#14171d] to-[#101319] p-4">
        <h3 className="mb-5 text-3xl font-semibold leading-none text-white/90">Cost Summary</h3>

        <div className="space-y-3">
          {moduleOptions.length === 0 ? (
            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/60">
              No modules yet
            </div>
          ) : (
            moduleOptions.map((moduleName) => (
              <button
                key={moduleName}
                type="button"
                onClick={() => onScopeChange(moduleName)}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left",
                  scope === moduleName
                    ? "border-white/70 bg-white/[0.08] text-white"
                    : "border-white/10 bg-white/[0.03] text-white/80 hover:border-white/25",
                )}
              >
                <span className="text-xl font-semibold leading-none">{moduleName}</span>
                <span className="text-xl font-medium leading-none">
                  {moduleCostMap.has(moduleName)
                    ? formatMoney(moduleCostMap.get(moduleName) ?? 0, currency)
                    : "--"}
                </span>
              </button>
            ))
          )}

          <button
            type="button"
            onClick={() => onScopeChange("all")}
            className={cn(
              "flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left",
              scope === "all"
                ? "border-white/70 bg-white/[0.08] text-white"
                : "border-white/10 bg-white/[0.03] text-white/80 hover:border-white/25",
            )}
          >
            <span className="text-2xl font-semibold leading-none">Total</span>
            <span className="text-2xl font-semibold leading-none">
              {formatMoney(data?.total_monthly_cost ?? 0, currency)}/mo
            </span>
          </button>

          <div className="flex items-start gap-2 text-sm leading-snug text-white/55">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Costs are calculated using your Terraform configuration.</p>
          </div>
        </div>
      </aside>

      <section className="min-w-0 flex-1 bg-[#07090d]">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs font-medium text-white/75">
            v0.0.1
          </span>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {error && <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-200">{error}</div>}

        <div className="grid grid-cols-[minmax(0,1.6fr)_160px_160px_180px] border-b border-white/10 px-4 py-3 text-xs font-medium uppercase tracking-[0.12em] text-white/60">
          <span>Resource</span>
          <span>Quantity</span>
          <span>Units</span>
          <span className="text-right">Monthly Cost</span>
        </div>

        <ScrollArea className="h-[calc(100%-7.5rem)]">
          {loading ? (
            <div className="px-4 py-8 text-sm text-white/60">Calculating costs...</div>
          ) : data?.resources.length ? (
            <div>
              {[...groupedResources.entries()].map(([moduleName, resources]) => (
                <div key={moduleName} className="border-b border-white/10">
                  <div className="grid grid-cols-[minmax(0,1.6fr)_160px_160px_180px] bg-white/[0.02] px-4 py-3 text-sm font-semibold text-white/90">
                    <span>{moduleName}</span>
                    <span />
                    <span />
                    <span className="text-right">
                      {formatMoney(
                        modules.find((item) => item.name === moduleName)?.monthly_cost ?? 0,
                        currency,
                      )}
                    </span>
                  </div>

                  {resources.map((resource) => {
                    const expanded = expandedResourceIds.has(resource.id);
                    return (
                      <div key={resource.id} className="border-t border-white/5">
                        <button
                          type="button"
                          onClick={() => onToggleResource(resource.id)}
                          className="grid w-full grid-cols-[minmax(0,1.6fr)_160px_160px_180px] items-center px-4 py-2.5 text-left text-sm text-white/90 hover:bg-white/[0.03]"
                        >
                          <span className="flex items-center gap-2 truncate">
                            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            <span className="truncate">{resource.resource_type}.{resource.resource_name}</span>
                          </span>
                          <span>{resource.quantity === 0 ? "0" : resource.quantity || "-"}</span>
                          <span>{resource.unit || "-"}</span>
                          <span className="text-right">{formatMoney(resource.monthly_cost, currency)}</span>
                        </button>

                        {expanded && (
                          <div className="border-t border-white/5 bg-white/[0.02] px-4 py-2">
                            {resource.components.length === 0 ? (
                              <p className="text-xs text-white/50">No cost components available.</p>
                            ) : (
                              <div className="space-y-1.5">
                                {resource.components.map((component) => (
                                  <div
                                    key={component.id}
                                    className="grid grid-cols-[minmax(0,1.6fr)_160px_160px_180px] text-xs text-white/70"
                                  >
                                    <span className="truncate pl-6">{component.name}</span>
                                    <span>
                                      {component.monthly_quantity === 0
                                        ? "0"
                                        : component.monthly_quantity || "-"}
                                    </span>
                                    <span>{component.unit || "-"}</span>
                                    <span className="text-right">
                                      {formatMoney(component.monthly_cost, currency)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-8 text-sm text-white/60">No cost data yet.</div>
          )}

          <div className="border-t border-white/10 px-4 py-3 text-xs text-white/50">
            Not all Terraform resources are supported for cost analysis. Check Infracost docs for
            full support coverage.
          </div>

          {data?.warnings && data.warnings.length > 0 && (
            <div className="space-y-1 px-4 pb-4 text-xs text-amber-200/90">
              {data.warnings.map((warning, idx) => (
                <p key={`${idx}-${warning.slice(0, 12)}`}>{warning}</p>
              ))}
            </div>
          )}
        </ScrollArea>

        {moduleOptions.length > 0 && (
          <div className="border-t border-white/10 px-4 py-2 text-xs text-white/40">
            Available modules: {moduleOptions.join(", ")}
          </div>
        )}
      </section>
    </div>
  );
}
