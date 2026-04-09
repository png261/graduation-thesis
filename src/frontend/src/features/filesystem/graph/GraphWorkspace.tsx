import { useEffect, useMemo, useState } from "react";
import { Background, BackgroundVariant, Controls, ReactFlow } from "@xyflow/react";

import type { OpenTofuGraphNode, OpenTofuGraphResult } from "../../../api/projects/index";
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

const GRAPH_VIEW_OPTIONS = [
  ["detailed", "Detailed"],
  ["category", "Category"],
  ["architecture", "Architecture"],
] as const;

interface GraphWorkspaceProps {
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
}

function useRenderPhase(adapter: ReturnType<typeof createGraphAdapter> | null, mode: GraphViewMode, scope: string) {
  const [renderPhase, setRenderPhase] = useState<"core" | "full">("core");
  useEffect(() => {
    if (!adapter) return;
    setRenderPhase("core");
    const timer = window.setTimeout(() => setRenderPhase("full"), 48);
    return () => window.clearTimeout(timer);
  }, [adapter, mode, scope]);
  return renderPhase;
}

function useFlowData(
  adapter: ReturnType<typeof createGraphAdapter> | null,
  mode: GraphViewMode,
  scope: string,
  renderPhase: "core" | "full",
  graphZoom: number,
) {
  return useMemo(() => {
    if (!adapter) return EMPTY_FLOW;
    return adapter.getFlowData(mode, scope, { phase: renderPhase, zoom: graphZoom });
  }, [adapter, graphZoom, mode, renderPhase, scope]);
}

function useSelectedCanvasNode(
  selectedNodeId: string | null,
  flowData: GraphFlowData,
  adapter: ReturnType<typeof createGraphAdapter> | null,
) {
  return useMemo(() => {
    if (!selectedNodeId) return null;
    const direct = flowData.nodeLookup.get(selectedNodeId);
    if (direct) return direct;
    return adapter?.getGraphNodeByFlowId(selectedNodeId) ?? null;
  }, [adapter, flowData.nodeLookup, selectedNodeId]);
}

function getEmptyMessage(data: OpenTofuGraphResult | null, loading: boolean, error: string, modules: string[]) {
  if (loading) return "";
  if (error) return error;
  if (!data) return "No graph data loaded yet.";
  if (modules.length < 1) return "No OpenTofu modules found. Add modules under /modules and refresh.";
  if (data.warnings.length > 0) return data.warnings[0];
  return "No dependency graph was generated for the selected scope.";
}

function GraphModeSwitcher({ mode, onModeChange }: { mode: GraphViewMode; onModeChange: (mode: GraphViewMode) => void }) {
  return (
    <div className="inline-flex rounded-xl border border-[var(--da-border)] bg-[var(--da-panel)] p-1 shadow-sm">
      {GRAPH_VIEW_OPTIONS.map(([value, label]) => (
        <button key={value} type="button" onClick={() => onModeChange(value)} className={cn("rounded-lg px-4 py-1.5 text-sm font-medium", mode === value ? "bg-[var(--da-elevated)] text-[var(--da-text)] shadow-[inset_0_0_0_1px_rgba(37,99,235,0.28)]" : "text-[var(--da-muted)] hover:text-[var(--da-text)]")}>
          {label}
        </button>
      ))}
    </div>
  );
}

function GraphToolbar({ mode, onModeChange }: { mode: GraphViewMode; onModeChange: (mode: GraphViewMode) => void }) {
  return (
    <div className="absolute right-5 top-4 z-20 flex items-center gap-3">
      <GraphModeSwitcher mode={mode} onModeChange={onModeChange} />
    </div>
  );
}

function GraphCanvas({
  flowData,
  onSelectedNodeIdChange,
  onMoveEnd,
}: {
  flowData: GraphFlowData;
  onSelectedNodeIdChange: (nodeId: string | null) => void;
  onMoveEnd: (zoom: number) => void;
}) {
  return (
    <ReactFlow nodes={flowData.nodes} edges={flowData.edges} fitView fitViewOptions={{ padding: 0.18, duration: 220 }} minZoom={0.2} maxZoom={2} onlyRenderVisibleElements nodeTypes={graphNodeTypes} onNodeClick={(_, node) => onSelectedNodeIdChange(node.id)} onPaneClick={() => onSelectedNodeIdChange(null)} onMoveEnd={(_, viewport) => onMoveEnd(viewport.zoom)} defaultEdgeOptions={{ style: { stroke: "rgba(125, 145, 176, 0.38)", strokeWidth: 1.5 } }} className="h-full w-full">
      <Background variant={BackgroundVariant.Dots} gap={28} size={1.2} color="rgba(148,163,184,0.55)" />
      <Controls position="bottom-right" />
    </ReactFlow>
  );
}

function GraphLoadingOverlay({ loading }: { loading: boolean }) {
  if (!loading) return null;
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/55 text-sm text-[var(--da-text)] backdrop-blur-[1px]">
      Loading graph...
    </div>
  );
}

function GraphEmptyOverlay({ loading, hasGraphData, emptyMessage }: { loading: boolean; hasGraphData: boolean; emptyMessage: string }) {
  if (loading || hasGraphData) return null;
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center p-6">
      <div className="max-w-xl rounded-xl border border-[var(--da-border)] bg-[var(--da-panel)] px-5 py-4 text-center text-sm text-[var(--da-text)] shadow-sm">{emptyMessage}</div>
    </div>
  );
}

function GraphErrorBanner({ error }: { error: string }) {
  if (!error) return null;
  return <div className="absolute left-4 top-4 z-20 rounded-md bg-red-500/10 px-3 py-1.5 text-sm text-red-700">{error}</div>;
}

function GraphDetailsOverlay({ details, onClose }: { details: OpenTofuGraphNode | null; onClose: () => void }) {
  if (!details) return null;
  return <GraphDetailsPanel details={details} onClose={onClose} />;
}

function useGraphWorkspaceViewModel(args: Pick<GraphWorkspaceProps, "data" | "mode" | "scope" | "selectedNodeId" | "selectedNode" | "loading" | "error" | "modules">) {
  const [graphZoom, setGraphZoom] = useState(1);
  const adapter = useMemo(() => (args.data ? createGraphAdapter(args.data) : null), [args.data?.snapshot.etag, args.data]);
  const renderPhase = useRenderPhase(adapter, args.mode, args.scope);
  const flowData = useFlowData(adapter, args.mode, args.scope, renderPhase, graphZoom);
  const selectedFromCanvas = useSelectedCanvasNode(args.selectedNodeId, flowData, adapter);
  const details = args.selectedNode ?? selectedFromCanvas;
  const hasGraphData = flowData.nodes.length > 0;
  const emptyMessage = getEmptyMessage(args.data, args.loading, args.error, args.modules);
  return { graphZoom, setGraphZoom, renderPhase, flowData, details, hasGraphData, emptyMessage };
}

export interface GraphWorkspaceMainPanelProps {
  data: OpenTofuGraphResult | null;
  loading: boolean;
  error: string;
  scope: string;
  mode: GraphViewMode;
  onModeChange: (mode: GraphViewMode) => void;
  modules: string[];
  stale: boolean;
  selectedNodeId: string | null;
  onSelectedNodeIdChange: (nodeId: string | null) => void;
  selectedNode: OpenTofuGraphNode | null;
  className?: string;
}

export function GraphWorkspaceMainPanel(props: GraphWorkspaceMainPanelProps) {
  const view = useGraphWorkspaceViewModel({
    data: props.data,
    loading: props.loading,
    error: props.error,
    scope: props.scope,
    mode: props.mode,
    modules: props.modules,
    selectedNodeId: props.selectedNodeId,
    selectedNode: props.selectedNode,
  });
  return (
    <section className={cn("relative min-w-0 flex-1", props.className)}>
      <GraphToolbar mode={props.mode} onModeChange={props.onModeChange} renderPhase={view.renderPhase} stale={props.stale} />
      <GraphErrorBanner error={props.error} />
      <GraphCanvas flowData={view.flowData} onSelectedNodeIdChange={props.onSelectedNodeIdChange} onMoveEnd={view.setGraphZoom} />
      <GraphLoadingOverlay loading={props.loading} />
      <GraphEmptyOverlay loading={props.loading} hasGraphData={view.hasGraphData} emptyMessage={view.emptyMessage} />
      <GraphDetailsOverlay details={view.details} onClose={() => props.onSelectedNodeIdChange(null)} />
    </section>
  );
}

export function GraphWorkspace(props: GraphWorkspaceProps) {
  return (
    <div className="flex h-full min-h-0 bg-[var(--da-bg)]">
      <GraphSidebar modules={props.modules} scope={props.scope} loading={props.loading} onScopeChange={props.onScopeChange} onRefresh={props.onRefresh} />
      <GraphWorkspaceMainPanel data={props.data} loading={props.loading} error={props.error} scope={props.scope} mode={props.mode} onModeChange={props.onModeChange} modules={props.modules} stale={props.stale} selectedNodeId={props.selectedNodeId} onSelectedNodeIdChange={props.onSelectedNodeIdChange} selectedNode={props.selectedNode} />
    </div>
  );
}
