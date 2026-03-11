import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { getOpenTofuCosts, type OpenTofuCostResult } from "../../../api/projects";

function normalizeScope(scope?: string) {
  const value = (scope ?? "").trim();
  return value || "all";
}

function useCostWorkspaceState() {
  const [costScope, setCostScope] = useState<string>("all");
  const [costData, setCostData] = useState<OpenTofuCostResult | null>(null);
  const [costLoading, setCostLoading] = useState(false);
  const [costError, setCostError] = useState("");
  const [expandedCostResources, setExpandedCostResources] = useState<Set<string>>(new Set());
  const costCacheRef = useRef<Map<string, OpenTofuCostResult>>(new Map());
  return {
    costScope,
    setCostScope,
    costData,
    setCostData,
    costLoading,
    setCostLoading,
    costError,
    setCostError,
    expandedCostResources,
    setExpandedCostResources,
    costCacheRef,
  };
}

function applyCachedCosts(
  cached: OpenTofuCostResult,
  setCostData: (value: OpenTofuCostResult) => void,
  setCostError: (value: string) => void,
  setCostLoading: (value: boolean) => void,
) {
  setCostData(cached);
  setCostError("");
  setCostLoading(false);
}

type UseLoadCostsArgs = {
  projectId: string;
  costScope: string;
  pushLog: (message: string) => void;
  setCostData: (value: OpenTofuCostResult) => void;
  setCostError: (value: string) => void;
  setCostLoading: (value: boolean) => void;
  costCacheRef: MutableRefObject<Map<string, OpenTofuCostResult>>;
};

function useLoadCosts(args: UseLoadCostsArgs) {
  const { projectId, costScope, pushLog, setCostData, setCostError, setCostLoading, costCacheRef } = args;
  return useCallback(async (options?: { refresh?: boolean; scope?: string }) => {
    const scope = normalizeScope(options?.scope ?? costScope);
    const refresh = options?.refresh === true;
    const cached = refresh ? undefined : costCacheRef.current.get(scope);
    if (cached) return applyCachedCosts(cached, setCostData, setCostError, setCostLoading);
    setCostLoading(true);
    setCostError("");
    try {
      const data = await getOpenTofuCosts(projectId, { module: scope, refresh });
      setCostData(data);
      costCacheRef.current.set(scope, data);
      pushLog(refresh ? `Refreshed cost estimate (${scope})` : `Loaded cost estimate (${scope})`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to load cost estimate";
      setCostError(message);
      pushLog(`Cost estimate error: ${message}`);
    } finally {
      setCostLoading(false);
    }
  }, [costCacheRef, costScope, projectId, pushLog, setCostData, setCostError, setCostLoading]);
}

function useEnsureCostsLoaded(args: {
  costLoading: boolean;
  costScope: string;
  loadCosts: (options?: { refresh?: boolean; scope?: string }) => Promise<void>;
  costCacheRef: MutableRefObject<Map<string, OpenTofuCostResult>>;
  setCostData: (value: OpenTofuCostResult) => void;
  setCostError: (value: string) => void;
}) {
  const { costLoading, costScope, loadCosts, costCacheRef, setCostData, setCostError } = args;
  return useCallback(async () => {
    if (costLoading) return;
    const scope = normalizeScope(costScope);
    const cached = costCacheRef.current.get(scope);
    if (cached) {
      setCostData(cached);
      setCostError("");
      return;
    }
    await loadCosts({ scope });
  }, [costCacheRef, costLoading, costScope, loadCosts, setCostData, setCostError]);
}

function useRefreshCosts(loadCosts: (options?: { refresh?: boolean; scope?: string }) => Promise<void>) {
  return useCallback(async () => {
    await loadCosts({ refresh: true });
  }, [loadCosts]);
}

function useToggleCostResource(setExpandedCostResources: Dispatch<SetStateAction<Set<string>>>) {
  return useCallback((resourceId: string) => {
    setExpandedCostResources((previous) => {
      const next = new Set(previous);
      if (next.has(resourceId)) next.delete(resourceId);
      else next.add(resourceId);
      return next;
    });
  }, [setExpandedCostResources]);
}

function useProjectCostResetEffect(args: {
  projectId: string;
  setCostScope: (value: string) => void;
  setCostData: (value: OpenTofuCostResult | null) => void;
  setCostError: (value: string) => void;
  setCostLoading: (value: boolean) => void;
  setExpandedCostResources: Dispatch<SetStateAction<Set<string>>>;
  costCacheRef: MutableRefObject<Map<string, OpenTofuCostResult>>;
}) {
  const { projectId, setCostScope, setCostData, setCostError, setCostLoading, setExpandedCostResources, costCacheRef } = args;
  useEffect(() => {
    costCacheRef.current.clear();
    setCostData(null);
    setCostError("");
    setCostLoading(false);
    setCostScope("all");
    setExpandedCostResources(new Set());
  }, [costCacheRef, projectId, setCostData, setCostError, setCostLoading, setCostScope, setExpandedCostResources]);
}

function useScopeCostResetEffect(
  costScope: string,
  setExpandedCostResources: Dispatch<SetStateAction<Set<string>>>,
) {
  useEffect(() => {
    setExpandedCostResources(new Set());
  }, [costScope, setExpandedCostResources]);
}

function useCostWorkspaceResetEffects(state: ReturnType<typeof useCostWorkspaceState>, projectId: string) {
  useProjectCostResetEffect({
    projectId,
    setCostScope: state.setCostScope,
    setCostData: state.setCostData,
    setCostError: state.setCostError,
    setCostLoading: state.setCostLoading,
    setExpandedCostResources: state.setExpandedCostResources,
    costCacheRef: state.costCacheRef,
  });
  useScopeCostResetEffect(state.costScope, state.setExpandedCostResources);
}

function useCostWorkspaceActions(
  state: ReturnType<typeof useCostWorkspaceState>,
  projectId: string,
  pushLog: (message: string) => void,
) {
  const loadCosts = useLoadCosts({
    projectId,
    costScope: state.costScope,
    pushLog,
    setCostData: state.setCostData,
    setCostError: state.setCostError,
    setCostLoading: state.setCostLoading,
    costCacheRef: state.costCacheRef,
  });
  const ensureCostsLoaded = useEnsureCostsLoaded({
    costLoading: state.costLoading,
    costScope: state.costScope,
    loadCosts,
    costCacheRef: state.costCacheRef,
    setCostData: state.setCostData,
    setCostError: state.setCostError,
  });
  const refreshCosts = useRefreshCosts(loadCosts);
  const toggleCostResource = useToggleCostResource(state.setExpandedCostResources);
  return { loadCosts, ensureCostsLoaded, refreshCosts, toggleCostResource };
}

function buildCostWorkspaceResult(
  state: ReturnType<typeof useCostWorkspaceState>,
  actions: ReturnType<typeof useCostWorkspaceActions>,
  costModules: string[],
) {
  return {
    costScope: state.costScope,
    setCostScope: state.setCostScope,
    costData: state.costData,
    costLoading: state.costLoading,
    costError: state.costError,
    costModules,
    expandedCostResources: state.expandedCostResources,
    ensureCostsLoaded: actions.ensureCostsLoaded,
    loadCosts: actions.loadCosts,
    refreshCosts: actions.refreshCosts,
    toggleCostResource: actions.toggleCostResource,
  };
}

export function useCostWorkspace(projectId: string, pushLog: (message: string) => void) {
  const state = useCostWorkspaceState();
  useCostWorkspaceResetEffects(state, projectId);
  const actions = useCostWorkspaceActions(state, projectId, pushLog);
  const costModules = useMemo(() => state.costData?.available_modules ?? [], [state.costData]);
  return buildCostWorkspaceResult(state, actions, costModules);
}
