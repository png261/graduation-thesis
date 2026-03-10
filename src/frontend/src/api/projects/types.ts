export type CloudProvider = "aws" | "gcloud";

export interface Project {
  id: string;
  name: string;
  provider: CloudProvider | null;
  createdAt: string;
}

export interface Thread {
  id: string;
  title: string;
  createdAt: string;
}

export interface FileEntry {
  path: string;
  size: number;
  modifiedAt: string;
  createdAt: string;
}

export interface Skill {
  name: string;
  description: string;
  content: string;
}

export interface CredentialsData {
  provider: string | null;
  credentials: Record<string, string>;
}

export type TemplateName = "opentofu";

export interface InitResult {
  ok: boolean;
  template: string;
  skills_added: string[];
}

export interface OpenTofuStatus {
  project_found: boolean;
  opentofu_available: boolean;
  provider: string | null;
  credential_ready: boolean;
  missing_credentials: string[];
  modules: string[];
  can_deploy: boolean;
}

export interface OpenTofuPreviewResult extends OpenTofuStatus {
  status: "ok" | "error";
  message?: string;
  intent: string;
  selected_modules: string[];
  reason: string;
  selector: "llm" | "fallback";
}

export interface OpenTofuCostComponent {
  id: string;
  name: string;
  monthly_quantity: number;
  unit: string;
  monthly_cost: number;
}

export interface OpenTofuCostResource {
  id: string;
  module: string;
  resource_name: string;
  resource_type: string;
  quantity: number;
  unit: string;
  monthly_cost: number;
  components: OpenTofuCostComponent[];
}

export interface OpenTofuCostModule {
  name: string;
  monthly_cost: number;
}

export interface OpenTofuCostResult {
  status: "ok" | "error";
  scope: string;
  generated_at: string;
  currency: string;
  modules: OpenTofuCostModule[];
  total_monthly_cost: number;
  resources: OpenTofuCostResource[];
  warnings: string[];
  available_modules: string[];
}

export interface OpenTofuGraphModule {
  name: string;
  provider: string;
  region: string;
  resource_count: number;
  node_count: number;
  edge_count: number;
  has_graph: boolean;
}

export interface OpenTofuGraphNode {
  id: string;
  module: string;
  label: string;
  kind: "environment" | "resource" | "provider" | "module" | "other";
  resource_type: string | null;
  resource_name: string | null;
  address: string | null;
  meta: Record<string, unknown>;
}

export interface OpenTofuGraphEdge {
  id: string;
  source: string;
  target: string;
  module: string;
  kind: string;
}

export interface OpenTofuGraphSnapshot {
  generated_at: string;
  scope: string;
  type: string;
  etag: string;
}

export interface OpenTofuGraphStats {
  module_count: number;
  node_count: number;
  edge_count: number;
  resource_count: number;
  kind_counts: Record<string, number>;
}

export interface OpenTofuGraphIndexes {
  nodes_by_module: Record<string, string[]>;
  nodes_by_kind: Record<string, string[]>;
  outgoing: Record<string, string[]>;
  incoming: Record<string, string[]>;
}

export interface OpenTofuGraphPayload {
  modules: OpenTofuGraphModule[];
  nodes: OpenTofuGraphNode[];
  edges: OpenTofuGraphEdge[];
  stats: OpenTofuGraphStats;
  indexes?: OpenTofuGraphIndexes;
}

export interface OpenTofuGraphResult {
  version: string;
  snapshot: OpenTofuGraphSnapshot;
  graph: OpenTofuGraphPayload;
  warnings: string[];
  raw_dot?: Record<string, string>;
}

export interface GitHubSession {
  authenticated: boolean;
  login?: string;
  githubUserId?: string;
  githubAccountId?: string;
  expiresAt?: string | null;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  owner_login: string;
}

export interface ProjectGitHubStatus {
  connected: boolean;
  repo_full_name: string | null;
  base_branch: string | null;
  working_branch: string | null;
  github_account_id: string | null;
  connected_at: string | null;
  session_authenticated: boolean;
  session_login: string | null;
  connected_account_login: string | null;
  session_account_matches: boolean;
}

export interface PullRequestResult {
  ok: boolean;
  url: string;
  number: number;
  title: string;
  repo_full_name: string;
  base_branch: string;
  working_branch: string;
}
