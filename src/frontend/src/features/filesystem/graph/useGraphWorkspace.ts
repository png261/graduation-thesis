import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getOpenTofuGraph, type OpenTofuGraphNode, type OpenTofuGraphResult } from "../../../api/projects/index";

export type GraphViewMode = "detailed" | "category" | "architecture";

const GRAPH_PAYLOAD_VERSION = "2";
const GRAPH_TYPE = "plan";

export function useGraphWorkspace(projectId: string, pushLog: (message: string) => void) {
  const [graphScope, setGraphScope] = useState<string>("all");
  const [graphViewMode, setGraphViewMode] = useState<GraphViewMode>("architecture");
  const [graphData, setGraphData] = useState<OpenTofuGraphResult | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphStale, setGraphStale] = useState(false);
  const [graphError, setGraphError] = useState("");
  const [selectedGraphNodeId, setSelectedGraphNodeId] = useState<string | null>(null);

  const cacheByScopeRef = useRef<Map<string, OpenTofuGraphResult>>(new Map());
  const cacheByEtagRef = useRef<Map<string, OpenTofuGraphResult>>(new Map());

  const loadGraph = useCallback(
    async (options?: { refresh?: boolean; scope?: string }) => {
      const scope = options?.scope ?? graphScope;
      const scopeKey = `${projectId}:${scope}:${GRAPH_TYPE}`;

      setGraphLoading(true);
      setGraphError("");

      const cachedScope = cacheByScopeRef.current.get(scopeKey);
      if (cachedScope && options?.refresh) {
        setGraphData(cachedScope);
        setGraphStale(true);
        pushLog(`Using cached graph while refreshing (${scope})`);
      }

      const start = performance.now();
      try {
        const data = await getOpenTofuGraph(projectId, {
          module: scope,
          type: GRAPH_TYPE,
          refresh: options?.refresh,
        });

        if (data.version !== GRAPH_PAYLOAD_VERSION) {
          throw new Error(
            `Unsupported graph payload version '${data.version}'. Expected '${GRAPH_PAYLOAD_VERSION}'.`,
          );
        }

        const etagKey = `${scopeKey}:${data.snapshot.etag}`;
        const cachedByEtag = cacheByEtagRef.current.get(etagKey);
        const nextData = cachedByEtag ?? data;
        const previousForScope = cacheByScopeRef.current.get(scopeKey);
        const durationMs = Math.round(performance.now() - start);

        setGraphData(nextData);
        setGraphStale(false);

        cacheByScopeRef.current.set(scopeKey, nextData);
        cacheByEtagRef.current.set(etagKey, nextData);

        if (data.graph.stats.node_count === 0 && data.warnings.length > 0) {
          setGraphError(data.warnings[0] || "Graph generation returned no data.");
        }

        if (data.warnings.length > 0) {
          pushLog(`Graph warning (${scope}): ${data.warnings[0]}`);
        }

        if (previousForScope?.snapshot.etag === data.snapshot.etag) {
          pushLog(
            `${options?.refresh ? "Refreshed" : "Loaded"} graph (${scope}) in ${durationMs}ms (snapshot unchanged)`,
          );
        } else {
          pushLog(
            `${options?.refresh ? "Refreshed" : "Loaded"} graph (${scope}) in ${durationMs}ms: ${data.graph.stats.node_count} nodes, ${data.graph.stats.edge_count} edges`,
          );
        }

        if (data.raw_dot && Object.keys(data.raw_dot).length > 0) {
          pushLog(`Graph debug payload includes raw DOT for ${Object.keys(data.raw_dot).length} module(s)`);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to load graph";
        setGraphError(message);
        setGraphStale(false);
        pushLog(`Graph error: ${message}`);
      } finally {
        setGraphLoading(false);
      }
    },
    [graphScope, projectId, pushLog],
  );

  const ensureGraphLoaded = useCallback(async () => {
    if (graphLoading || graphData) return;
    await loadGraph();
  }, [graphData, graphLoading, loadGraph]);

  const refreshGraph = useCallback(async () => {
    await loadGraph({ refresh: true });
  }, [loadGraph]);

  const selectedGraphNode: OpenTofuGraphNode | null = useMemo(() => {
    if (!graphData || !selectedGraphNodeId) return null;
    const normalizedId = selectedGraphNodeId.startsWith("resource:")
      ? selectedGraphNodeId.slice("resource:".length)
      : selectedGraphNodeId;
    return graphData.graph.nodes.find((node) => node.id === normalizedId) ?? null;
  }, [graphData, selectedGraphNodeId]);

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
  }, [projectId]);

  useEffect(() => {
    setSelectedGraphNodeId(null);
  }, [graphScope]);

  const graphModules = useMemo(
    () => graphData?.graph.modules.map((module) => module.name) ?? [],
    [graphData],
  );

  return {
    graphScope,
    setGraphScope,
    graphViewMode,
    setGraphViewMode,
    graphData,
    graphLoading,
    graphStale,
    graphError,
    graphModules,
    selectedGraphNodeId,
    setSelectedGraphNodeId,
    selectedGraphNode,
    ensureGraphLoaded,
    loadGraph,
    refreshGraph,
  };
}
