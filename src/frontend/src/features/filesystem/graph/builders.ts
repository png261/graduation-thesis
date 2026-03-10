import { MarkerType, type Edge, type Node } from "@xyflow/react";

import type {
  OpenTofuGraphEdge,
  OpenTofuGraphModule,
  OpenTofuGraphNode,
  OpenTofuGraphResult,
} from "../../../api/projects/index";
import type { GraphViewMode } from "./useGraphWorkspace";
import type { GraphNodeData } from "./types";

export type GraphRenderPhase = "core" | "full";

export type GraphFlowData = {
  nodes: Node<GraphNodeData>[];
  edges: Edge[];
  nodeLookup: Map<string, OpenTofuGraphNode>;
};

const CORE_RESOURCE_LIMIT_PER_MODULE = 24;

function buildEnvironmentGraphNode(module: OpenTofuGraphModule): OpenTofuGraphNode {
  return {
    id: `env:${module.name}`,
    module: module.name,
    label: module.name,
    kind: "environment",
    resource_type: null,
    resource_name: null,
    address: null,
    meta: {
      provider: module.provider,
      region: module.region,
      resource_count: module.resource_count,
      node_count: module.node_count,
      edge_count: module.edge_count,
      has_graph: module.has_graph,
    },
  };
}

function createEnvironmentNode(
  module: OpenTofuGraphModule,
  idx: number,
  resources: OpenTofuGraphNode[],
): Node<GraphNodeData> {
  const topResources = resources.slice(0, 3).map((resource) => ({
    name: resource.resource_name || resource.label,
    type: resource.resource_type || "resource",
  }));

  return {
    id: `env:${module.name}`,
    type: "environment",
    draggable: true,
    position: { x: 220 + idx * 560, y: 260 + (idx % 2) * 240 },
    data: {
      title: module.name,
      provider: module.provider,
      region: module.region,
      resources: topResources,
      node: buildEnvironmentGraphNode(module),
    },
    selectable: true,
  };
}

export class GraphAdapter {
  private readonly modules: OpenTofuGraphModule[];

  private readonly resourceNodesByModule = new Map<string, OpenTofuGraphNode[]>();

  private readonly edgesByModule = new Map<string, OpenTofuGraphEdge[]>();

  private readonly nodeById = new Map<string, OpenTofuGraphNode>();

  private readonly nodesByModule = new Map<string, OpenTofuGraphNode[]>();

  private readonly nodesByKind = new Map<string, OpenTofuGraphNode[]>();

  private readonly outgoing = new Map<string, string[]>();

  private readonly incoming = new Map<string, string[]>();

  private readonly viewCache = new Map<string, GraphFlowData>();

  constructor(private readonly payload: OpenTofuGraphResult) {
    this.modules = [...payload.graph.modules].sort((a, b) => a.name.localeCompare(b.name));

    for (const node of payload.graph.nodes) {
      this.nodeById.set(node.id, node);

      const moduleNodes = this.nodesByModule.get(node.module) ?? [];
      moduleNodes.push(node);
      this.nodesByModule.set(node.module, moduleNodes);

      const kindNodes = this.nodesByKind.get(node.kind) ?? [];
      kindNodes.push(node);
      this.nodesByKind.set(node.kind, kindNodes);
    }

    for (const module of this.modules) {
      const allModuleNodes = this.nodesByModule.get(module.name) ?? [];
      const moduleResources = this.sortResources(allModuleNodes.filter((node) => node.kind === "resource"));
      this.resourceNodesByModule.set(module.name, moduleResources);
    }

    for (const edge of payload.graph.edges) {
      const moduleEdges = this.edgesByModule.get(edge.module) ?? [];
      moduleEdges.push(edge);
      this.edgesByModule.set(edge.module, moduleEdges);
    }

    const indexes = payload.graph.indexes;
    if (indexes) {
      for (const [source, targets] of Object.entries(indexes.outgoing)) {
        this.outgoing.set(source, [...targets]);
      }
      for (const [target, sources] of Object.entries(indexes.incoming)) {
        this.incoming.set(target, [...sources]);
      }
    } else {
      for (const edge of payload.graph.edges) {
        const out = this.outgoing.get(edge.source) ?? [];
        out.push(edge.target);
        this.outgoing.set(edge.source, out);

        const incoming = this.incoming.get(edge.target) ?? [];
        incoming.push(edge.source);
        this.incoming.set(edge.target, incoming);
      }
    }
  }

  getModules(): string[] {
    return this.modules.map((module) => module.name);
  }

  getResourceNodeCount(): number {
    return (this.nodesByKind.get("resource") ?? []).length;
  }

  getGraphNodeByFlowId(flowNodeId: string | null): OpenTofuGraphNode | null {
    if (!flowNodeId) return null;
    if (flowNodeId.startsWith("resource:")) {
      const id = flowNodeId.slice("resource:".length);
      return this.nodeById.get(id) ?? null;
    }
    if (flowNodeId.startsWith("env:")) {
      const moduleName = flowNodeId.slice("env:".length);
      const module = this.modules.find((item) => item.name === moduleName);
      return module ? buildEnvironmentGraphNode(module) : null;
    }
    return null;
  }

  getFlowData(
    mode: GraphViewMode,
    scope: string,
    options?: { phase?: GraphRenderPhase; zoom?: number },
  ): GraphFlowData {
    const phase = options?.phase ?? "full";
    const zoom = options?.zoom ?? 1;
    const zoomBucket = zoom < 0.45 ? "low" : zoom < 0.7 ? "mid" : "high";
    const key = `${this.payload.snapshot.etag}|${mode}|${scope}|${phase}|${zoomBucket}`;
    const cached = this.viewCache.get(key);
    if (cached) return cached;

    const modules = this.modulesForScope(scope);
    const flow =
      mode === "category"
        ? this.buildCategoryFlow(modules, phase)
        : mode === "detailed"
          ? this.buildDetailedFlow(modules, phase, zoom)
          : this.buildArchitectureFlow(modules);

    this.viewCache.set(key, flow);
    return flow;
  }

  private modulesForScope(scope: string): OpenTofuGraphModule[] {
    if (scope === "all") return this.modules;
    return this.modules.filter((module) => module.name === scope);
  }

  private buildArchitectureFlow(modules: OpenTofuGraphModule[]): GraphFlowData {
    const nodes: Node<GraphNodeData>[] = [];
    const nodeLookup = new Map<string, OpenTofuGraphNode>();

    modules.forEach((module, idx) => {
      const resources = this.resourceNodesByModule.get(module.name) ?? [];
      const envNode = createEnvironmentNode(module, idx, resources);
      nodes.push(envNode);
      if (envNode.data.node) nodeLookup.set(envNode.id, envNode.data.node);
    });

    return { nodes, edges: [], nodeLookup };
  }

  private buildCategoryFlow(modules: OpenTofuGraphModule[], phase: GraphRenderPhase): GraphFlowData {
    const nodes: Node<GraphNodeData>[] = [];
    const edges: Edge[] = [];
    const nodeLookup = new Map<string, OpenTofuGraphNode>();

    modules.forEach((module, moduleIndex) => {
      const moduleResources = this.resourceNodesByModule.get(module.name) ?? [];
      const envNode = createEnvironmentNode(module, moduleIndex, moduleResources);
      envNode.position = { x: 170 + moduleIndex * 680, y: 120 };
      envNode.data.resources = [];
      nodes.push(envNode);
      if (envNode.data.node) nodeLookup.set(envNode.id, envNode.data.node);

      const grouped = new Map<string, OpenTofuGraphNode[]>();
      for (const resource of moduleResources) {
        const key = resource.resource_type || "other";
        const list = grouped.get(key) ?? [];
        list.push(resource);
        grouped.set(key, list);
      }

      const sortedGroups = [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      sortedGroups.forEach(([resourceType, items], categoryIdx) => {
        const categoryId = `category:${module.name}:${resourceType}`;
        nodes.push({
          id: categoryId,
          type: "category",
          position: {
            x: 220 + moduleIndex * 680,
            y: 380 + categoryIdx * 210,
          },
          data: {
            title: resourceType,
            count: items.length,
            node: null,
          },
        });

        edges.push({
          id: `${envNode.id}->${categoryId}`,
          source: envNode.id,
          target: categoryId,
          animated: true,
          style: { stroke: "rgba(120, 145, 190, 0.4)" },
        });

        if (phase === "core") return;

        items.forEach((resource, resourceIdx) => {
          const nodeId = `resource:${resource.id}`;
          nodes.push({
            id: nodeId,
            type: "resource",
            position: {
              x: 580 + moduleIndex * 680,
              y: 380 + categoryIdx * 210 + resourceIdx * 115,
            },
            data: {
              title: resource.resource_name || resource.label,
              subtitle: resource.resource_type || "resource",
              node: resource,
            },
          });
          nodeLookup.set(nodeId, resource);

          edges.push({
            id: `${categoryId}->${nodeId}`,
            source: categoryId,
            target: nodeId,
            style: { stroke: "rgba(120, 145, 190, 0.4)" },
          });
        });
      });
    });

    return { nodes, edges, nodeLookup };
  }

  private buildDetailedFlow(
    modules: OpenTofuGraphModule[],
    phase: GraphRenderPhase,
    zoom: number,
  ): GraphFlowData {
    const nodes: Node<GraphNodeData>[] = [];
    const edges: Edge[] = [];
    const nodeLookup = new Map<string, OpenTofuGraphNode>();

    for (const [moduleIndex, module] of modules.entries()) {
      const allResources = this.resourceNodesByModule.get(module.name) ?? [];
      const renderedResources =
        phase === "core" ? allResources.slice(0, CORE_RESOURCE_LIMIT_PER_MODULE) : allResources;

      const envNode = createEnvironmentNode(module, moduleIndex, []);
      envNode.position = { x: 250 + moduleIndex * 660, y: 120 };
      nodes.push(envNode);
      if (envNode.data.node) nodeLookup.set(envNode.id, envNode.data.node);

      renderedResources.forEach((resource, idx) => {
        const nodeId = `resource:${resource.id}`;
        nodes.push({
          id: nodeId,
          type: "resource",
          position: {
            x: 300 + moduleIndex * 660,
            y: 390 + idx * 155,
          },
          data: {
            title: resource.resource_name || resource.label,
            subtitle: resource.resource_type || "resource",
            node: resource,
          },
        });
        nodeLookup.set(nodeId, resource);

        if (idx === 0) {
          edges.push({
            id: `${envNode.id}->${nodeId}`,
            source: envNode.id,
            target: nodeId,
            style: { stroke: "rgba(141, 163, 208, 0.45)", strokeDasharray: "4 4" },
          });
        }
      });

      if (phase === "core") continue;

      const renderedIds = new Set(renderedResources.map((resource) => resource.id));
      const moduleEdges = this.edgesByModule.get(module.name) ?? [];
      for (const edge of moduleEdges) {
        if (!renderedIds.has(edge.source) || !renderedIds.has(edge.target)) continue;
        edges.push({
          id: edge.id,
          source: `resource:${edge.source}`,
          target: `resource:${edge.target}`,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "rgba(161, 182, 224, 0.7)",
            width: 12,
            height: 12,
          },
          style: {
            stroke: "rgba(161, 182, 224, 0.65)",
            strokeWidth: 1.5,
            strokeDasharray: "6 6",
          },
        });
      }
    }

    const culled = this.cullEdgesForZoom(edges, zoom);
    return { nodes, edges: culled, nodeLookup };
  }

  private cullEdgesForZoom(edges: Edge[], zoom: number): Edge[] {
    if (zoom < 0.45 && edges.length > 500) {
      return [...edges].sort((a, b) => a.id.localeCompare(b.id)).slice(0, 500);
    }
    if (zoom < 0.7 && edges.length > 900) {
      return [...edges].sort((a, b) => a.id.localeCompare(b.id)).slice(0, 900);
    }
    return edges;
  }

  private sortResources(resources: OpenTofuGraphNode[]): OpenTofuGraphNode[] {
    return [...resources].sort((a, b) => {
      const aInbound = this.incoming.get(a.id)?.length ?? Number(a.meta?.in_degree ?? 0);
      const bInbound = this.incoming.get(b.id)?.length ?? Number(b.meta?.in_degree ?? 0);
      if (aInbound !== bInbound) return aInbound - bInbound;

      const aOutbound = this.outgoing.get(a.id)?.length ?? Number(a.meta?.out_degree ?? 0);
      const bOutbound = this.outgoing.get(b.id)?.length ?? Number(b.meta?.out_degree ?? 0);
      if (aOutbound !== bOutbound) return aOutbound - bOutbound;

      return (a.resource_name || a.label).localeCompare(b.resource_name || b.label);
    });
  }
}

export function createGraphAdapter(payload: OpenTofuGraphResult): GraphAdapter {
  return new GraphAdapter(payload);
}
