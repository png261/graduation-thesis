import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { getOpenTofuGraph, type OpenTofuGraphNode, type OpenTofuGraphResult } from "../../../api/projects/index";

export type GraphViewMode = "detailed" | "category" | "architecture";

const GRAPH_PAYLOAD_VERSION = "2";
const GRAPH_TYPE = "plan";

type GraphLoadOptions = { refresh?: boolean; scope?: string };

function buildScopeKey(projectId: string, scope: string) {
  return `${projectId}:${scope}:${GRAPH_TYPE}`;
}

function setGraphLoadingState(setGraphLoading: (value: boolean) => void, setGraphError: (value: string) => void) {
  setGraphLoading(true);
  setGraphError("");
}

function showCachedGraphWhileRefreshing(args: {
  scope: string;
  refresh: boolean;
  scopeKey: string;
  cacheByScopeRef: MutableRefObject<Map<string, OpenTofuGraphResult>>;
  setGraphData: Dispatch<SetStateAction<OpenTofuGraphResult | null>>;
  setGraphStale: (value: boolean) => void;
  pushLog: (message: string) => void;
}) {
  if (!args.refresh) return;
  const cached = args.cacheByScopeRef.current.get(args.scopeKey);
  if (!cached) return;
  args.setGraphData(cached);
  args.setGraphStale(true);
  args.pushLog(`Using cached graph while refreshing (${args.scope})`);
}

function ensureGraphPayloadVersion(data: OpenTofuGraphResult) {
  if (data.version === GRAPH_PAYLOAD_VERSION) return;
  throw new Error(`Unsupported graph payload version '${data.version}'. Expected '${GRAPH_PAYLOAD_VERSION}'.`);
}

async function fetchGraphPayload(projectId: string, scope: string, refresh: boolean) {
  const start = performance.now();
  const data = await getOpenTofuGraph(projectId, { module: scope, type: GRAPH_TYPE, refresh });
  ensureGraphPayloadVersion(data);
  const durationMs = Math.round(performance.now() - start);
  return { data, durationMs };
}

function getCachedGraphByEtag(args: {
  data: OpenTofuGraphResult;
  scopeKey: string;
  cacheByEtagRef: MutableRefObject<Map<string, OpenTofuGraphResult>>;
}) {
  const etagKey = `${args.scopeKey}:${args.data.snapshot.etag}`;
  const cached = args.cacheByEtagRef.current.get(etagKey);
  return { etagKey, nextData: cached ?? args.data };
}

function logGraphWarnings(data: OpenTofuGraphResult, scope: string, setGraphError: (value: string) => void, pushLog: (message: string) => void) {
  if (data.graph.stats.node_count === 0 && data.warnings.length > 0) {
    setGraphError(data.warnings[0] || "Graph generation returned no data.");
  }
  if (data.warnings.length > 0) pushLog(`Graph warning (${scope}): ${data.warnings[0]}`);
}

function logGraphSummary(args: {
  data: OpenTofuGraphResult;
  scope: string;
  refresh: boolean;
  durationMs: number;
  previousForScope?: OpenTofuGraphResult;
  pushLog: (message: string) => void;
}) {
  const action = args.refresh ? "Refreshed" : "Loaded";
  if (args.previousForScope?.snapshot.etag === args.data.snapshot.etag) {
    args.pushLog(`${action} graph (${args.scope}) in ${args.durationMs}ms (snapshot unchanged)`);
    return;
  }
  args.pushLog(`${action} graph (${args.scope}) in ${args.durationMs}ms: ${args.data.graph.stats.node_count} nodes, ${args.data.graph.stats.edge_count} edges`);
}

function logGraphDebugPayload(data: OpenTofuGraphResult, pushLog: (message: string) => void) {
  if (!data.raw_dot || Object.keys(data.raw_dot).length < 1) return;
  pushLog(`Graph debug payload includes raw DOT for ${Object.keys(data.raw_dot).length} module(s)`);
}

function applyGraphPayload(args: {
  data: OpenTofuGraphResult;
  scope: string;
  scopeKey: string;
  refresh: boolean;
  durationMs: number;
  cacheByScopeRef: MutableRefObject<Map<string, OpenTofuGraphResult>>;
  cacheByEtagRef: MutableRefObject<Map<string, OpenTofuGraphResult>>;
  setGraphData: Dispatch<SetStateAction<OpenTofuGraphResult | null>>;
  setGraphStale: (value: boolean) => void;
  setGraphError: (value: string) => void;
  pushLog: (message: string) => void;
}) {
  const previousForScope = args.cacheByScopeRef.current.get(args.scopeKey);
  const { etagKey, nextData } = getCachedGraphByEtag({
    data: args.data,
    scopeKey: args.scopeKey,
    cacheByEtagRef: args.cacheByEtagRef,
  });
  args.setGraphData(nextData);
  args.setGraphStale(false);
  args.cacheByScopeRef.current.set(args.scopeKey, nextData);
  args.cacheByEtagRef.current.set(etagKey, nextData);
  logGraphWarnings(args.data, args.scope, args.setGraphError, args.pushLog);
  logGraphSummary({ data: args.data, scope: args.scope, refresh: args.refresh, durationMs: args.durationMs, previousForScope, pushLog: args.pushLog });
  logGraphDebugPayload(args.data, args.pushLog);
}

function reportGraphError(
  error: unknown,
  setGraphError: (value: string) => void,
  setGraphStale: (value: boolean) => void,
  pushLog: (message: string) => void,
) {
  const message = error instanceof Error ? error.message : "Failed to load graph";
  setGraphError(message);
  setGraphStale(false);
  pushLog(`Graph error: ${message}`);
}

function useGraphWorkspaceState() {
  const [graphScope, setGraphScope] = useState<string>("all");
  const [graphViewMode, setGraphViewMode] = useState<GraphViewMode>("architecture");
  const [graphData, setGraphData] = useState<OpenTofuGraphResult | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphStale, setGraphStale] = useState(false);
  const [graphError, setGraphError] = useState("");
  const [selectedGraphNodeId, setSelectedGraphNodeId] = useState<string | null>(null);
  const cacheByScopeRef = useRef<Map<string, OpenTofuGraphResult>>(new Map());
  const cacheByEtagRef = useRef<Map<string, OpenTofuGraphResult>>(new Map());
  return {
    graphScope, setGraphScope, graphViewMode, setGraphViewMode, graphData, setGraphData, graphLoading, setGraphLoading, graphStale, setGraphStale, graphError, setGraphError, selectedGraphNodeId, setSelectedGraphNodeId, cacheByScopeRef, cacheByEtagRef,
  };
}

type GraphWorkspaceState = ReturnType<typeof useGraphWorkspaceState>;

function useLoadGraph(args: {
  projectId: string;
  graphScope: string;
  pushLog: (message: string) => void;
  setGraphData: Dispatch<SetStateAction<OpenTofuGraphResult | null>>;
  setGraphLoading: Dispatch<SetStateAction<boolean>>;
  setGraphStale: Dispatch<SetStateAction<boolean>>;
  setGraphError: Dispatch<SetStateAction<string>>;
  cacheByScopeRef: MutableRefObject<Map<string, OpenTofuGraphResult>>;
  cacheByEtagRef: MutableRefObject<Map<string, OpenTofuGraphResult>>;
}) {
  const { projectId, graphScope, pushLog, setGraphData, setGraphLoading, setGraphStale, setGraphError, cacheByScopeRef, cacheByEtagRef } = args;
  return useCallback(async (options?: GraphLoadOptions) => {
    const scope = options?.scope ?? graphScope;
    const refresh = options?.refresh === true;
    const scopeKey = buildScopeKey(projectId, scope);
    setGraphLoadingState(setGraphLoading, setGraphError);
    showCachedGraphWhileRefreshing({ scope, refresh, scopeKey, cacheByScopeRef, setGraphData, setGraphStale, pushLog });
    try {
      const payload = await fetchGraphPayload(projectId, scope, refresh);
      applyGraphPayload({ data: payload.data, scope, scopeKey, refresh, durationMs: payload.durationMs, cacheByScopeRef, cacheByEtagRef, setGraphData, setGraphStale, setGraphError, pushLog });
    } catch (error: unknown) {
      reportGraphError(error, setGraphError, setGraphStale, pushLog);
    } finally {
      setGraphLoading(false);
    }
  }, [cacheByEtagRef, cacheByScopeRef, graphScope, projectId, pushLog, setGraphData, setGraphError, setGraphLoading, setGraphStale]);
}

function useEnsureGraphLoaded(
  graphLoading: boolean,
  graphData: OpenTofuGraphResult | null,
  loadGraph: (options?: GraphLoadOptions) => Promise<void>,
) {
  return useCallback(async () => {
    if (graphLoading || graphData) return;
    await loadGraph();
  }, [graphData, graphLoading, loadGraph]);
}

function useRefreshGraph(loadGraph: (options?: GraphLoadOptions) => Promise<void>) {
  return useCallback(async () => {
    await loadGraph({ refresh: true });
  }, [loadGraph]);
}

function normalizeSelectedGraphNodeId(value: string) {
  return value.startsWith("resource:") ? value.slice("resource:".length) : value;
}

function useSelectedGraphNode(graphData: OpenTofuGraphResult | null, selectedGraphNodeId: string | null) {
  return useMemo(() => {
    if (!graphData || !selectedGraphNodeId) return null;
    const normalizedId = normalizeSelectedGraphNodeId(selectedGraphNodeId);
    return graphData.graph.nodes.find((node) => node.id === normalizedId) ?? null;
  }, [graphData, selectedGraphNodeId]);
}

function useProjectGraphReset(projectId: string, state: GraphWorkspaceState) {
  const { setGraphData, setGraphError, setGraphLoading, setGraphStale, setGraphScope, setGraphViewMode, setSelectedGraphNodeId, cacheByScopeRef, cacheByEtagRef } = state;
  useEffect(() => {
    setGraphData(null);
    setGraphError("");
    setGraphLoading(false);
    setGraphStale(false);
    setGraphScope("all");
    setGraphViewMode("architecture");
    setSelectedGraphNodeId(null);
    cacheByScopeRef.current.clear();
    cacheByEtagRef.current.clear();
  }, [cacheByEtagRef, cacheByScopeRef, projectId, setGraphData, setGraphError, setGraphLoading, setGraphScope, setGraphStale, setGraphViewMode, setSelectedGraphNodeId]);
}

function useScopeSelectionReset(graphScope: string, setSelectedGraphNodeId: Dispatch<SetStateAction<string | null>>) {
  useEffect(() => {
    setSelectedGraphNodeId(null);
  }, [graphScope, setSelectedGraphNodeId]);
}

function useGraphWorkspaceActions(state: GraphWorkspaceState, projectId: string, pushLog: (message: string) => void) {
  const loadGraph = useLoadGraph({
    projectId,
    graphScope: state.graphScope,
    pushLog,
    setGraphData: state.setGraphData,
    setGraphLoading: state.setGraphLoading,
    setGraphStale: state.setGraphStale,
    setGraphError: state.setGraphError,
    cacheByScopeRef: state.cacheByScopeRef,
    cacheByEtagRef: state.cacheByEtagRef,
  });
  const ensureGraphLoaded = useEnsureGraphLoaded(state.graphLoading, state.graphData, loadGraph);
  const refreshGraph = useRefreshGraph(loadGraph);
  return { loadGraph, ensureGraphLoaded, refreshGraph };
}

function buildGraphWorkspaceResult(args: {
  state: GraphWorkspaceState;
  graphModules: string[];
  selectedGraphNode: OpenTofuGraphNode | null;
  actions: ReturnType<typeof useGraphWorkspaceActions>;
}) {
  return {
    graphScope: args.state.graphScope,
    setGraphScope: args.state.setGraphScope,
    graphViewMode: args.state.graphViewMode,
    setGraphViewMode: args.state.setGraphViewMode,
    graphData: args.state.graphData,
    graphLoading: args.state.graphLoading,
    graphStale: args.state.graphStale,
    graphError: args.state.graphError,
    graphModules: args.graphModules,
    selectedGraphNodeId: args.state.selectedGraphNodeId,
    setSelectedGraphNodeId: args.state.setSelectedGraphNodeId,
    selectedGraphNode: args.selectedGraphNode,
    ensureGraphLoaded: args.actions.ensureGraphLoaded,
    loadGraph: args.actions.loadGraph,
    refreshGraph: args.actions.refreshGraph,
  };
}

export function useGraphWorkspace(projectId: string, pushLog: (message: string) => void) {
  const state = useGraphWorkspaceState();
  useProjectGraphReset(projectId, state);
  useScopeSelectionReset(state.graphScope, state.setSelectedGraphNodeId);
  const actions = useGraphWorkspaceActions(state, projectId, pushLog);
  const graphModules = useMemo(() => state.graphData?.graph.modules.map((module) => module.name) ?? [], [state.graphData]);
  const selectedGraphNode = useSelectedGraphNode(state.graphData, state.selectedGraphNodeId);
  return buildGraphWorkspaceResult({ state, graphModules, selectedGraphNode, actions });
}
