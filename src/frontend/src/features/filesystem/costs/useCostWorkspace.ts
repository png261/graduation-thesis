import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getOpenTofuCosts, type OpenTofuCostResult } from "../../../api/projects";

export function useCostWorkspace(projectId: string, pushLog: (message: string) => void) {
  const [costScope, setCostScope] = useState<string>("all");
  const [costData, setCostData] = useState<OpenTofuCostResult | null>(null);
  const [costLoading, setCostLoading] = useState(false);
  const [costError, setCostError] = useState("");
  const [expandedCostResources, setExpandedCostResources] = useState<Set<string>>(new Set());
  const costCacheRef = useRef<Map<string, OpenTofuCostResult>>(new Map());

  const loadCosts = useCallback(
    async (options?: { refresh?: boolean; scope?: string }) => {
      const scope = (options?.scope ?? costScope).trim() || "all";
      const refresh = options?.refresh === true;
      const cached = !refresh ? costCacheRef.current.get(scope) : undefined;
      if (cached) {
        setCostData(cached);
        setCostError("");
        setCostLoading(false);
        return;
      }

      setCostLoading(true);
      setCostError("");
      try {
        const data = await getOpenTofuCosts(projectId, {
          module: scope,
          refresh,
        });
        setCostData(data);
        costCacheRef.current.set(scope, data);
        pushLog(
          refresh
            ? `Refreshed cost estimate (${scope})`
            : `Loaded cost estimate (${scope})`,
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to load cost estimate";
        setCostError(message);
        pushLog(`Cost estimate error: ${message}`);
      } finally {
        setCostLoading(false);
      }
    },
    [costScope, projectId, pushLog],
  );

  const ensureCostsLoaded = useCallback(async () => {
    if (costLoading) return;
    const scope = costScope.trim() || "all";
    const cached = costCacheRef.current.get(scope);
    if (cached) {
      setCostData(cached);
      setCostError("");
      return;
    }
    await loadCosts({ scope });
  }, [costLoading, costScope, loadCosts]);

  const refreshCosts = useCallback(async () => {
    await loadCosts({ refresh: true });
  }, [loadCosts]);

  const toggleCostResource = useCallback((resourceId: string) => {
    setExpandedCostResources((prev) => {
      const next = new Set(prev);
      if (next.has(resourceId)) next.delete(resourceId);
      else next.add(resourceId);
      return next;
    });
  }, []);

  useEffect(() => {
    costCacheRef.current.clear();
    setCostData(null);
    setCostError("");
    setCostLoading(false);
    setCostScope("all");
    setExpandedCostResources(new Set());
  }, [projectId]);

  useEffect(() => {
    setExpandedCostResources(new Set());
  }, [costScope]);

  const costModules = useMemo(() => costData?.available_modules ?? [], [costData]);

  return {
    costScope,
    setCostScope,
    costData,
    costLoading,
    costError,
    costModules,
    expandedCostResources,
    ensureCostsLoaded,
    loadCosts,
    refreshCosts,
    toggleCostResource,
  };
}
