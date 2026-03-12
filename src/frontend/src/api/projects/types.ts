import type { components as GeneratedComponents } from "../generated/openapi-types";

type GeneratedSchemas = GeneratedComponents extends { schemas: infer S } ? S : never;
type GeneratedProjectJobKind = NonNullable<
  GeneratedSchemas extends { ProjectJobKind?: infer T } ? T : never
>;
type GeneratedProjectJobStatus = NonNullable<
  GeneratedSchemas extends { ProjectJobStatus?: infer T } ? T : never
>;

export type CloudProvider = "aws" | "gcloud";

export interface Project {
  id: string;
  name: string;
  provider: CloudProvider | null;
  createdAt: string;
}

export type ProjectJobKind =
  [GeneratedProjectJobKind] extends [never]
    ? "pipeline" | "apply" | "plan" | "ansible" | "graph" | "cost"
    : GeneratedProjectJobKind;
export type ProjectJobStatus =
  [GeneratedProjectJobStatus] extends [never]
    ? "queued" | "running" | "succeeded" | "failed" | "canceled"
    : GeneratedProjectJobStatus;

export interface ProjectJobEvent {
  seq?: number;
  type: string;
  status?: string;
  message?: string;
  [key: string]: unknown;
}

export interface ProjectJob {
  id: string;
  project_id: string;
  user_id: string;
  kind: ProjectJobKind;
  status: ProjectJobStatus;
  params: {
    selected_modules?: string[];
    intent?: string | null;
    options?: Record<string, unknown>;
  };
  result: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  event_tail: ProjectJobEvent[];
  celery_task_id: string | null;
  rerun_of_job_id: string | null;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  cancel_requested_at: string | null;
}

export interface ProjectJobListResult {
  total: number;
  items: ProjectJob[];
}

export interface EnqueueProjectJobBody {
  kind: ProjectJobKind;
  selected_modules?: string[];
  intent?: string | null;
  options?: Record<string, unknown>;
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

export interface PathMove {
  from: string;
  to: string;
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

export interface AnsibleStatus {
  project_found: boolean;
  ansible_available: boolean;
  provider: string | null;
  key_ready: boolean;
  playbooks: string[];
  playbook_path: string;
  modules: string[];
  host_count: number;
  missing_requirements: string[];
  output_errors: string[];
  config_summary: {
    playbook_files: string[];
    role_task_files: string[];
    task_names: string[];
    package_targets: string[];
    service_targets: string[];
    file_targets: string[];
    module_usage_top: Array<{ module: string; count: number }>;
  };
  latest_run: {
    run_id: string;
    status: "ok" | "failed";
    attempts: number;
    modules: string[];
    host_count: number;
    results: Array<{
      host: string;
      status: "ok" | "failed" | "unreachable";
      ok: number;
      changed: number;
      unreachable: number;
      failed: number;
    }>;
    finished_at: string;
  } | null;
  can_run: boolean;
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

export interface ProjectRunHistoryItem {
  id: string;
  project_id: string;
  user_id: string;
  kind: string;
  status: string;
  params: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface ProjectRunHistoryResult {
  total: number;
  items: ProjectRunHistoryItem[];
}

export interface ProjectDriftStatus {
  status: "no_modules" | "state_missing" | "plan_missing" | "plan_outdated" | "in_sync";
  module_count: number;
  modules_without_state: string[];
  last_plan_job: ProjectRunHistoryItem | null;
  last_apply_job: ProjectRunHistoryItem | null;
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
  connected_at: string | null;
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

export interface ProjectTelegramStatus {
  connected: boolean;
  chat_id: string | null;
  topic_id: string | null;
  topic_title: string | null;
  requires_reconnect: boolean;
  connected_at: string | null;
  pending: boolean;
  pending_expires_at: string | null;
  warning?: string;
}

export interface ProjectTelegramConnectResult extends ProjectTelegramStatus {
  connect_url: string;
}

export type StateBackendProvider = "aws" | "gcs";
export type StateBackendSource = "cloud" | "github" | "gitlab";

export interface CredentialProfile {
  id: string;
  name: string;
  provider: StateBackendProvider;
  meta: Record<string, unknown>;
  credentials: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface StateBackend {
  id: string;
  project_id: string;
  name: string;
  source_type: StateBackendSource;
  provider: StateBackendProvider;
  status: string;
  bucket_name: string | null;
  object_key: string | null;
  object_prefix: string | null;
  repository: string | null;
  branch: string | null;
  path: string | null;
  schedule_minutes: number;
  retention_days: number;
  versioning_enabled: boolean | null;
  warning: string | null;
  settings: Record<string, unknown>;
  last_sync_at: string | null;
  last_error: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface StateResource {
  id: string;
  address: string;
  resource_type: string;
  resource_name: string;
  provider: string | null;
  status: string;
  cloud_id: string | null;
  console_url: string | null;
  attributes: Record<string, unknown>;
  sensitive_fields: unknown[];
  last_updated_at: string | null;
}

export interface StateHistoryItem {
  id: string;
  version: string | null;
  etag: string | null;
  resource_count: number;
  added: number;
  deleted: number;
  changed: number;
  created_at: string | null;
  source_updated_at: string | null;
}

export interface DriftAlert {
  id: string;
  backend_id: string;
  resource_address: string;
  severity: string;
  status: string;
  details: Record<string, unknown>;
  remediation?: Record<string, unknown> | null;
  first_detected_at: string | null;
  last_detected_at: string | null;
  resolved_at: string | null;
}

export interface PolicyAlert {
  id: string;
  backend_id: string;
  resource_address: string;
  rule_id: string;
  severity: string;
  status: string;
  details: Record<string, unknown>;
  first_detected_at: string | null;
  last_detected_at: string | null;
  resolved_at: string | null;
}

export interface StateSyncRun {
  id: string;
  status: string;
  triggered_by: string;
  summary: Record<string, unknown>;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string | null;
}

export interface StateBackendSettings {
  backend: StateBackend;
  sync_runs: StateSyncRun[];
}

export interface GitLabSession {
  authenticated: boolean;
  login?: string;
  provider_user_id?: string;
  expires_at?: string | null;
}

export interface GitLabRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  owner_login?: string | null;
}

export interface StateBackendImportCandidate {
  provider: StateBackendProvider;
  bucket: string;
  key: string;
  prefix: string;
  source_path: string;
  name: string;
}
