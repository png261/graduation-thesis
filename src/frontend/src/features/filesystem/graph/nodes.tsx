import type { Node, NodeProps, NodeTypes } from "@xyflow/react";
import { Box, Layers } from "lucide-react";

import { cn } from "../../../lib/utils";
import type { GraphNodeData } from "./types";

type GraphFlowNode = Node<GraphNodeData>;

function EnvironmentResourceCard({ name, type }: { name: string; type: string }) {
  return (
    <div className="rounded-xl border border-[var(--da-border)] bg-[var(--da-panel)] px-4 py-3">
      <div className="flex items-center gap-2 text-xl font-semibold leading-none text-[var(--da-text)]">
        <Box className="h-5 w-5 text-blue-300" />
        {name}
      </div>
      <div className="mt-1 text-sm leading-none text-[var(--da-muted)]">{type || "resource"}</div>
    </div>
  );
}

function EnvironmentNodeHeader({ title, provider, region }: { title: string; provider?: string; region?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--da-border)] bg-[var(--da-elevated)] px-6 py-4">
      <h4 className="text-2xl font-semibold leading-none text-[var(--da-text)]">{title}</h4>
      <div className="flex items-center gap-3">
        {provider ? <span className="rounded-full border border-[var(--da-border)] bg-[var(--da-panel)] px-3 py-1 text-xs font-semibold uppercase text-[var(--da-text)]">{provider}</span> : null}
        {region ? <span className="text-sm font-medium text-[var(--da-muted)]">{region}</span> : null}
      </div>
    </div>
  );
}

function EnvironmentResourceList({ resources }: { resources: Array<{ name: string; type: string }> }) {
  if (resources.length < 1) {
    return <div className="rounded-xl border border-dashed border-[var(--da-border)] px-4 py-6 text-sm text-[var(--da-muted)]">No resources found.</div>;
  }
  return (
    <div className="space-y-2">
      {resources.map((resource) => (
        <EnvironmentResourceCard key={`${resource.type}:${resource.name}`} name={resource.name} type={resource.type} />
      ))}
    </div>
  );
}

function EnvironmentCardNode({ data, selected }: NodeProps<GraphFlowNode>) {
  const resources = data.resources ?? [];
  return (
    <div className={cn("w-[420px] overflow-hidden rounded-3xl border border-[var(--da-border)] bg-gradient-to-br from-[var(--da-panel)] to-[var(--da-elevated)] shadow-[0_20px_50px_-30px_rgba(15,23,42,0.28)]", selected && "border-blue-400/80 shadow-[0_0_0_1px_rgba(96,165,250,0.6)]")}>
      <EnvironmentNodeHeader title={data.title} provider={data.provider} region={data.region} />
      <div className="px-6 py-5">
        <EnvironmentResourceList resources={resources} />
      </div>
    </div>
  );
}

function ResourceCardNode({ data, selected }: NodeProps<GraphFlowNode>) {
  return (
    <div
      className={cn(
        "w-[300px] rounded-2xl border border-[var(--da-border)] bg-[var(--da-panel)] px-4 py-3 shadow-[0_12px_32px_-22px_rgba(15,23,42,0.18)]",
        selected && "border-blue-400/80 shadow-[0_0_0_1px_rgba(96,165,250,0.75)]",
      )}
    >
      <div className="flex items-center gap-2 text-xl font-semibold leading-none text-[var(--da-text)]">
        <Layers className="h-4 w-4 text-blue-300" />
        <span className="truncate">{data.title}</span>
      </div>
      <p className="mt-1 text-sm leading-none text-[var(--da-muted)]">{data.subtitle || "resource"}</p>
    </div>
  );
}

function CategoryNode({ data, selected }: NodeProps<GraphFlowNode>) {
  return (
    <div
      className={cn(
        "w-[300px] rounded-2xl border border-[var(--da-border)] bg-[var(--da-panel)] px-4 py-3",
        selected && "border-blue-400/80",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h5 className="truncate text-lg font-semibold leading-none text-[var(--da-text)]">{data.title}</h5>
        <span className="rounded-full border border-[var(--da-border)] px-2 py-0.5 text-xs text-[var(--da-muted)]">{data.count ?? 0}</span>
      </div>
    </div>
  );
}

export const graphNodeTypes: NodeTypes = {
  environment: EnvironmentCardNode,
  resource: ResourceCardNode,
  category: CategoryNode,
};
