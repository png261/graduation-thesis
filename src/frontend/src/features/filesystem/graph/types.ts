import type { OpenTofuGraphNode } from "../../../api/projects/index";

export type GraphNodeData = {
  title: string;
  subtitle?: string;
  provider?: string;
  region?: string;
  resources?: Array<{ name: string; type: string }>;
  count?: number;
  node: OpenTofuGraphNode | null;
};
