import type { components as GeneratedComponents } from "../generated/openapi-types";

type GeneratedSchemas = GeneratedComponents extends { schemas: infer S } ? S : never;
type GeneratedProjectJobKind = NonNullable<
  GeneratedSchemas extends { ProjectJobKind?: infer T } ? T : never
>;
type GeneratedProjectJobStatus = NonNullable<
  GeneratedSchemas extends { ProjectJobStatus?: infer T } ? T : never
>;

export type CloudProvider = "aws" | "gcloud";

export interface ProjectTerraformValidation {
  status: "pass" | "fail";
  checkedModules: string[];
  missing: string[];
  violations: string[];
  requireAnsible: boolean;
  requireTargetContract?: boolean;
}

export interface ProjectTerraformTargetContractSchema {
  schemaVersion: number;
  moduleOutputName: string;
  canonicalOutputName: string;
  legacyOutputName: string;
  requiredFields: string[];
  optionalFields: string[];
  dedupeKey: string;
}

export interface ProjectTerraformTarget {
  execution_id: string;
  role: string;
  source_modules: string[];
  display_name?: string;
  platform?: string;
  private_ip?: string;
  public_ip?: string;
  hostname?: string;
  labels?: Record<string, string>;
  tags?: Record<string, string>;
}

export interface ProjectTerraformTargetContract {
  status: "valid" | "invalid" | "missing" | "unvalidated";
  stale: boolean;
  validated_at: string | null;
  target_count: number;
  targets: ProjectTerraformTarget[];
  validation_errors: string[];
  schema_version: number;
  module_output_name: string;
  canonical_output_name: string;
  legacy_output_name: string;
}

export interface ProjectSsmReadinessTarget {
  execution_id: string;
  resolved_instance_id: string | null;
  resolved_managed_instance_id: string | null;
  display_name: string;
  role: string;
  source_modules: string[];
  expected_platform: string | null;
  registration_status: string;
  ping_status: string;
  platform_status: string;
  last_seen_at: string | null;
  ready: boolean;
  blocking_reason: string | null;
}

export interface ProjectSsmReadiness {
  status: string;
  blocking: boolean;
  scope_mode: string;
  selected_modules: string[];
  checked_at: string | null;
  timeout_seconds: number;
  target_count: number;
  ready_target_count: number;
  pending_target_count: number;
  failed_target_count: number;
  blocker_code: string | null;
  blocker_message: string;
  targets: ProjectSsmReadinessTarget[];
  failed_targets: ProjectSsmReadinessTarget[];
}

export interface ProjectTerraformGenerationCompare {
  hasPrevious: boolean;
  previousGenerationId?: string | null;
  addedModules: string[];
  removedModules: string[];
  changedModules: string[];
  addedFiles: string[];
  removedFiles: string[];
  changedFiles: string[];
  inputsChanged: boolean;
}

export interface ProjectTerraformGenerationSummary {
  headline: string;
  inputs: Record<string, string>;
  stackPath: string;
  moduleCount: number;
  fileCount: number;
  latestGenerationId?: string | null;
  mode?: "generate" | "regenerate";
  removedModules?: string[];
  removedFiles?: string[];
  inputsChanged?: boolean;
}

export interface ProjectTerraformGenerationRecord {
  id: string;
  projectId: string;
  stackPath: string;
  moduleNames: string[];
  generatedPaths: Record<string, string>;
  summary: ProjectTerraformGenerationSummary;
  targetContract: ProjectTerraformTargetContractSchema;
  targetContractSummary: string;
  provenanceReportPath: string;
  replacesGenerationId: string | null;
  createdAt: string | null;
  compare: ProjectTerraformGenerationCompare | null;
}

export interface ProjectTerraformGenerationPreview {
  status: "ok";
  stackPath: string;
  moduleNames: string[];
  generatedFiles: string[];
  validation: ProjectTerraformValidation;
  mode: "generate" | "regenerate";
  inputsChanged: boolean;
  removedModules: string[];
  summary: ProjectTerraformGenerationSummary;
  targetContract: ProjectTerraformTargetContractSchema;
  targetContractSummary: string;
  validationIssues: string[];
  latestGeneration: ProjectTerraformGenerationRecord | null;
  previewToken: string;
}

export interface ProjectTerraformGenerationResult extends ProjectTerraformGenerationPreview {
  writtenFiles: string[];
  removedFiles: string[];
  provenanceReportPath: string;
  generation: ProjectTerraformGenerationRecord;
}

export interface ProjectAnsibleGenerationCompare {
  hasPrevious: boolean;
  previousGenerationId?: string | null;
  addedModules: string[];
  removedModules: string[];
  changedModules: string[];
  addedFiles: string[];
  removedFiles: string[];
  changedFiles: string[];
  inputsChanged: boolean;
}

export interface ProjectAnsibleGenerationSummary {
  headline: string;
  inputs: Record<string, string>;
  playbookPath: string;
  roleCount: number;
  fileCount: number;
  terraformGenerationId: string;
  latestGenerationId?: string | null;
  mode?: "generate" | "regenerate";
  removedRoles?: string[];
  removedFiles?: string[];
  inputsChanged?: boolean;
  targetModules?: string[];
  skippedModules?: string[];
}

export interface ProjectAnsibleGenerationRecord {
  id: string;
  projectId: string;
  playbookPath: string;
  targetModules: string[];
  skippedModules: string[];
  generatedPaths: Record<string, string>;
  summary: ProjectAnsibleGenerationSummary;
  provenanceReportPath: string;
  replacesGenerationId: string | null;
  createdAt: string | null;
  compare: ProjectAnsibleGenerationCompare | null;
}

export interface ProjectAnsibleGenerationPreview {
  status: "ok";
  playbookPath: string;
  targetModules: string[];
  skippedModules: string[];
  generatedFiles: string[];
  validation: ProjectTerraformValidation;
  mode: "generate" | "regenerate";
  inputsChanged: boolean;
  removedRoles: string[];
  summary: ProjectAnsibleGenerationSummary;
  validationIssues: string[];
  latestGeneration: ProjectAnsibleGenerationRecord | null;
  previewToken: string;
}

export interface ProjectAnsibleGenerationResult extends ProjectAnsibleGenerationPreview {
  writtenFiles: string[];
  removedFiles: string[];
  provenanceReportPath: string;
  generation: ProjectAnsibleGenerationRecord;
}

export interface Project {
  id: string;
  name: string;
  provider: CloudProvider | null;
  createdAt: string;
}

export type ProjectJobKind =
  [GeneratedProjectJobKind] extends [never]
    ? "pipeline" | "apply" | "plan" | "destroy" | "ansible" | "graph" | "cost"
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

export interface ProjectPostDeploySection {
  items: Array<Record<string, unknown>>;
  raw?: string | null;
  truncated?: boolean;
  redacted?: boolean;
  truncated_reason?: string | null;
}

export interface ProjectPostDeployHost {
  status?: string;
  ready?: boolean;
  host: {
    name: string;
    address?: string;
    module?: string;
  };
  system?: ProjectPostDeploySection;
  services?: ProjectPostDeploySection;
  packages?: ProjectPostDeploySection;
  health_checks?: ProjectPostDeploySection;
  service_logs?: ProjectPostDeploySection;
}

export interface ProjectPostDeploySummary {
  status: string;
  host_count: number;
  skipped_host_count: number;
  service_count: number;
  health_summary: string;
  collected_at?: string | null;
}

export interface ProjectJobStageState {
  status: string;
  started_at?: string | null;
  finished_at?: string | null;
  message?: string | null;
}

export interface ProjectJobStageSummary {
  apply?: ProjectJobStageState;
  ssm_readiness?: ProjectJobStageState;
  ansible?: ProjectJobStageState;
  post_deploy?: ProjectJobStageState;
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
    review_session_id?: string | null;
    review_target?: string | null;
    scope_mode?: string | null;
    confirmation?: {
      project_name?: string;
      keyword?: string;
      selected_modules?: string[];
    } | null;
    options?: Record<string, unknown>;
  };
  result: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  event_tail: ProjectJobEvent[];
  post_deploy_summary?: ProjectPostDeploySummary;
  post_deploy_hosts?: ProjectPostDeployHost[];
  stage_summary?: ProjectJobStageSummary;
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
  review_session_id?: string | null;
  review_target?: string | null;
  scope_mode?: string | null;
  confirmation?: {
    project_name?: string;
    keyword?: string;
    selected_modules?: string[];
  } | null;
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


export interface CredentialsData {
  provider: string | null;
  credentials: Record<string, string>;
  required_fields: string[];
  missing_fields: string[];
  apply_ready: boolean;
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

export interface AnsibleTransportSummary {
  mode: string;
  target_count: number;
  target_ids: string[];
  display_names: string[];
}

export interface AnsibleLatestRunSummary {
  run_id: string;
  status: "ok" | "failed";
  attempts: number;
  modules: string[];
  selected_modules: string[];
  host_count: number;
  target_count: number;
  target_ids: string[];
  transport: AnsibleTransportSummary | null;
  results: Array<{
    host: string;
    status: "ok" | "failed" | "unreachable";
    ok: number;
    changed: number;
    unreachable: number;
    failed: number;
  }>;
  finished_at: string;
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
  generationReady: boolean;
  generationStale: boolean;
  configurationRequired: boolean;
  targetModules: string[];
  skippedModules: string[];
  ssm_ready: boolean;
  ssm_readiness: ProjectSsmReadiness | null;
  latestGeneration: ProjectAnsibleGenerationRecord | null;
  config_summary: {
    playbook_files: string[];
    role_task_files: string[];
    task_names: string[];
    package_targets: string[];
    service_targets: string[];
    file_targets: string[];
    module_usage_top: Array<{ module: string; count: number }>;
  };
  latest_run: AnsibleLatestRunSummary | null;
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
  post_deploy_summary?: ProjectPostDeploySummary;
  post_deploy_hosts?: ProjectPostDeployHost[];
  stage_summary?: ProjectJobStageSummary;
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

export type StateBackendProvider = "aws" | "gcs";
export type StateBackendSource = "cloud" | "github";

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

export interface StateBackendImportCandidate {
  provider: StateBackendProvider;
  bucket: string;
  key: string;
  prefix: string;
  source_path: string;
  name: string;
}
