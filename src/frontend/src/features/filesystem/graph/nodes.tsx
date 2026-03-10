import type { Node, NodeProps, NodeTypes } from "@xyflow/react";
import { Box, Layers } from "lucide-react";

import { cn } from "../../../lib/utils";
import type { GraphNodeData } from "./types";

type GraphFlowNode = Node<GraphNodeData>;

function EnvironmentCardNode({ data, selected }: NodeProps<GraphFlowNode>) {
  return (
    <div
      className={cn(
        "w-[420px] overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.12] to-white/[0.02] shadow-[0_24px_70px_-30px_rgba(0,0,0,0.85)]",
        selected && "border-blue-400/80 shadow-[0_0_0_1px_rgba(96,165,250,0.8)]",
      )}
    >
      <div className="flex items-center justify-between border-b border-white/10 bg-black/25 px-6 py-4">
        <h4 className="text-2xl font-semibold leading-none text-white">{data.title}</h4>
        <div className="flex items-center gap-3">
          {data.provider && (
            <span className="rounded-full border border-white/30 bg-white/15 px-3 py-1 text-xs font-semibold uppercase text-white/90">
              {data.provider}
            </span>
          )}
          {data.region && <span className="text-sm font-medium text-white/70">{data.region}</span>}
        </div>
      </div>
      <div className="px-6 py-5">
        {data.resources && data.resources.length > 0 ? (
          <div className="space-y-2">
            {data.resources.map((resource: { name: string; type: string }) => (
              <div key={`${resource.type}:${resource.name}`} className="rounded-xl border border-white/10 bg-black/40 px-4 py-3">
                <div className="flex items-center gap-2 text-xl font-semibold leading-none text-white/95">
                  <Box className="h-5 w-5 text-blue-300" />
                  {resource.name}
                </div>
                <div className="mt-1 text-sm leading-none text-white/55">{resource.type || "resource"}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-white/15 px-4 py-6 text-sm text-white/55">No resources found.</div>
        )}
      </div>
    </div>
  );
}

function ResourceCardNode({ data, selected }: NodeProps<GraphFlowNode>) {
  return (
    <div
      className={cn(
        "w-[300px] rounded-2xl border border-white/12 bg-black/55 px-4 py-3 shadow-[0_12px_40px_-22px_rgba(0,0,0,0.8)]",
        selected && "border-blue-400/80 shadow-[0_0_0_1px_rgba(96,165,250,0.75)]",
      )}
    >
      <div className="flex items-center gap-2 text-xl font-semibold leading-none text-white/95">
        <Layers className="h-4 w-4 text-blue-300" />
        <span className="truncate">{data.title}</span>
      </div>
      <p className="mt-1 text-sm leading-none text-white/55">{data.subtitle || "resource"}</p>
    </div>
  );
}

function CategoryNode({ data, selected }: NodeProps<GraphFlowNode>) {
  return (
    <div
      className={cn(
        "w-[300px] rounded-2xl border border-white/12 bg-white/[0.05] px-4 py-3",
        selected && "border-blue-400/80",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h5 className="truncate text-lg font-semibold leading-none text-white">{data.title}</h5>
        <span className="rounded-full border border-white/20 px-2 py-0.5 text-xs text-white/70">{data.count ?? 0}</span>
      </div>
    </div>
  );
}

export const graphNodeTypes: NodeTypes = {
  environment: EnvironmentCardNode,
  resource: ResourceCardNode,
  category: CategoryNode,
};
