import { useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
} from "@xyflow/react";

import type {
  OpenTofuGraphNode,
  OpenTofuGraphResult,
} from "../../../api/projects/index";
import { cn } from "../../../lib/utils";
import { createGraphAdapter, type GraphFlowData } from "./builders";
import { GraphDetailsPanel } from "./GraphDetailsPanel";
import { graphNodeTypes } from "./nodes";
import { GraphSidebar } from "./GraphSidebar";
import type { GraphViewMode } from "./useGraphWorkspace";

const EMPTY_FLOW: GraphFlowData = {
  nodes: [],
  edges: [],
  nodeLookup: new Map<string, OpenTofuGraphNode>(),
};

export function GraphWorkspace({
  data,
  loading,
  error,
  scope,
  onScopeChange,
  mode,
  onModeChange,
  modules,
  stale,
  selectedNodeId,
  onSelectedNodeIdChange,
  selectedNode,
  onRefresh,
}: {
  data: OpenTofuGraphResult | null;
  loading: boolean;
  error: string;
  scope: string;
  onScopeChange: (scope: string) => void;
  mode: GraphViewMode;
  onModeChange: (mode: GraphViewMode) => void;
  modules: string[];
  stale: boolean;
  selectedNodeId: string | null;
  onSelectedNodeIdChange: (nodeId: string | null) => void;
  selectedNode: OpenTofuGraphNode | null;
  onRefresh: () => void;
}) {
  const [renderPhase, setRenderPhase] = useState<"core" | "full">("core");
  const [graphZoom, setGraphZoom] = useState(1);

  const adapter = useMemo(() => {
    if (!data) return null;
    return createGraphAdapter(data);
  }, [data?.snapshot.etag, data]);

  useEffect(() => {
    if (!adapter) return;
    setRenderPhase("core");
    const timer = window.setTimeout(() => {
      setRenderPhase("full");
    }, 48);
    return () => {
      window.clearTimeout(timer);
    };
  }, [adapter, mode, scope]);

  const flowData = useMemo(() => {
    if (!adapter) return EMPTY_FLOW;
    return adapter.getFlowData(mode, scope, { phase: renderPhase, zoom: graphZoom });
  }, [adapter, mode, scope, renderPhase, graphZoom]);

  const selectedFromCanvas = useMemo(() => {
    if (!selectedNodeId) return null;
    const direct = flowData.nodeLookup.get(selectedNodeId) ?? null;
    if (direct) return direct;
    return adapter?.getGraphNodeByFlowId(selectedNodeId) ?? null;
  }, [adapter, flowData.nodeLookup, selectedNodeId]);

  const details = selectedNode ?? selectedFromCanvas;
  const hasGraphData = flowData.nodes.length > 0;
  const emptyMessage = (() => {
    if (loading) return "";
    if (error) return error;
    if (!data) return "No graph data loaded yet.";
    if (modules.length === 0) {
      return "No OpenTofu modules found. Add modules under /modules and refresh.";
    }
    if (data.warnings.length > 0) {
      return data.warnings[0];
    }
    return "No dependency graph was generated for the selected scope.";
  })();

  return (
    <div className="flex h-full min-h-0 bg-[#07090d]">
      <GraphSidebar
        modules={modules}
        scope={scope}
        loading={loading}
        onScopeChange={onScopeChange}
        onRefresh={onRefresh}
      />

      <section className="relative min-w-0 flex-1">
        <div className="absolute right-5 top-4 z-20 flex items-center gap-3">
          <div className="inline-flex rounded-xl border border-white/10 bg-black/55 p-1">
            {([
              ["detailed", "Detailed"],
              ["category", "Category"],
              ["architecture", "Architecture"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => onModeChange(value)}
                className={cn(
                  "rounded-lg px-4 py-1.5 text-sm font-medium",
                  mode === value
                    ? "bg-black text-white shadow-[inset_0_0_0_1px_rgba(140,182,255,0.7)]"
                    : "text-white/65 hover:text-white",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="rounded-md border border-white/10 bg-black/55 px-2.5 py-1 text-xs text-white/80">
            {renderPhase === "core" ? "Quick render" : "Full render"}
          </div>
          {stale && (
            <div className="rounded-md border border-amber-300/30 bg-amber-500/15 px-2.5 py-1 text-xs text-amber-200">
              Stale cache
            </div>
          )}
        </div>

        {error && <div className="absolute left-4 top-4 z-20 rounded-md bg-red-500/20 px-3 py-1.5 text-sm text-red-200">{error}</div>}

        <ReactFlow
          nodes={flowData.nodes}
          edges={flowData.edges}
          fitView
          fitViewOptions={{ padding: 0.18, duration: 220 }}
          minZoom={0.2}
          maxZoom={2}
          onlyRenderVisibleElements
          nodeTypes={graphNodeTypes}
          onNodeClick={(_, node) => onSelectedNodeIdChange(node.id)}
          onPaneClick={() => onSelectedNodeIdChange(null)}
          onMoveEnd={(_, viewport) => setGraphZoom(viewport.zoom)}
          defaultEdgeOptions={{
            style: { stroke: "rgba(133, 154, 190, 0.45)", strokeWidth: 1.5 },
          }}
          className="h-full w-full"
        >
          <Background variant={BackgroundVariant.Dots} gap={28} size={1.2} color="rgba(93,120,161,0.55)" />
          <Controls position="bottom-right" />
        </ReactFlow>

        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/25 text-sm text-white/80">
            Loading graph...
          </div>
        )}

        {!loading && !hasGraphData && (
          <div className="absolute inset-0 z-10 flex items-center justify-center p-6">
            <div className="max-w-xl rounded-xl border border-white/15 bg-black/55 px-5 py-4 text-center text-sm text-white/85">
              {emptyMessage}
            </div>
          </div>
        )}

        {details && (
          <GraphDetailsPanel
            details={details}
            onClose={() => onSelectedNodeIdChange(null)}
          />
        )}
      </section>
    </div>
  );
}
