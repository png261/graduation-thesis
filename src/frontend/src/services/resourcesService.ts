import type { ChatSession } from "@/components/chat/types"
import type { SelectedRepository } from "@/lib/agentcore-client/types"

type AwsExports = {
  resourcesApiUrl?: string
}

let resourcesApiBaseUrl = ""

async function loadResourcesApiBaseUrl(): Promise<string> {
  if (resourcesApiBaseUrl) {
    return resourcesApiBaseUrl
  }

  const response = await fetch("/aws-exports.json")
  if (!response.ok) {
    throw new Error("Resources API URL not configured")
  }
  const config = (await response.json()) as AwsExports
  if (!config.resourcesApiUrl) {
    throw new Error("Resources API URL not configured")
  }
  resourcesApiBaseUrl = config.resourcesApiUrl
  return resourcesApiBaseUrl
}

async function request<T>(path: string, idToken: string, init?: RequestInit): Promise<T> {
  const baseUrl = await loadResourcesApiBaseUrl()
  const response = await fetch(`${baseUrl}${path.replace(/^\//, "")}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
      ...(init?.headers ?? {}),
    },
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.error || `Resources API failed with status ${response.status}`)
  }
  return payload as T
}

export type AwsCredentialMetadata = {
  configured: boolean
  credentialId?: string
  name?: string
  accountId?: string
  region?: string
  hasSessionToken?: boolean
  accessKeyIdSuffix?: string
  updatedAt?: string
}

export type AwsCredentialPayload = {
  credentialId?: string
  name?: string
  accountId?: string
  region?: string
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
}

export type AwsCredentialsResponse = {
  credentials: AwsCredentialMetadata[]
  activeCredentialId?: string
}

export type S3BucketInfo = {
  name: string
  createdAt?: string
}

export type StateBackend = {
  backendId: string
  name: string
  bucket: string
  key: string
  region: string
  service?: "s3" | "ec2" | "iam" | string
  credentialId?: string
  credentialName?: string
  repository?: SelectedRepository | null
  planUpdatedAt?: string
  graphBucket?: string
  graphKey?: string
  graphGeneratedAt?: string
  graphResourceCount?: number
  graphError?: string
  createdAt: string
  updatedAt: string
}

export type StateBackendResource = {
  address?: string
  mode?: string
  type?: string
  name?: string
  module?: string
  index?: string | number
  providerName?: string
  values?: Record<string, unknown>
  backendId: string
  backendName?: string
  stateBucket?: string
  stateKey?: string
  stateRegion?: string
  service?: string
  repository?: SelectedRepository | null
  updatedAt?: string
}

export type StateBackendPayload = {
  name: string
  bucket: string
  key: string
  region: string
  service?: "s3" | "ec2" | "iam" | string
  credentialId?: string
  repository: SelectedRepository
}

export type ResourceScan = {
  scanId: string
  backendId: string
  backendName?: string
  stateBucket?: string
  stateKey?: string
  stateRegion?: string
  service?: string
  status: "RUNNING" | "SUCCEEDED" | "FAILED" | string
  startedAt: string
  updatedAt: string
  driftAlerts: unknown[]
  policyAlerts: unknown[]
  currentResources: unknown[]
  repository?: SelectedRepository | null
  error?: string
  rawResult?: unknown
  codeBuildBuildId?: string
  guardId?: string
  graphBucket?: string
  graphKey?: string
  graphGeneratedAt?: string
  graphResourceCount?: number
  graphError?: string
}

export type DriftGuardFrequency = "manual" | "hourly" | "daily" | "weekly" | "monthly"

export type DriftGuard = {
  guardId: string
  name: string
  backendId: string
  repository?: string
  frequency: DriftGuardFrequency
  email?: string
  enabled: boolean
  scheduleName?: string
  alertTopicArn?: string
  lastScanId?: string
  lastRunAt?: string
  createdAt: string
  updatedAt: string
}

export type DriftGuardPayload = {
  guardId?: string
  name: string
  backendId: string
  repository?: string
  frequency: DriftGuardFrequency
  email?: string
  enabled?: boolean
}

export type ResourceScanLogEvent = {
  timestamp?: number
  message: string
}

export type ResourceScanLogs = {
  events: ResourceScanLogEvent[]
  nextForwardToken?: string | null
  logGroupName?: string | null
  logStreamName?: string | null
}

export type ResourceGraphUrl = {
  url: string
  expiresIn: number
  scanId?: string
  backendId?: string
  graphGeneratedAt?: string
  graphResourceCount?: number
}

export type TerraformSourceFile = {
  name: string
  content: string
}

export type TerraformPlanJob = {
  jobId: string
  backendId: string
  backendName?: string
  bucket: string
  key: string
  region: string
  service: string
  repository?: SelectedRepository | null
  files: string[]
  status: "RUNNING" | "SUCCEEDED" | "FAILED" | string
  phase?: string
  error?: string
  createdAt: string
  updatedAt: string
  codeBuildBuildId?: string
}

export type GitHubPullRequestStatus = {
  repository: string
  number: number
  title: string
  state: string
  githubState?: string
  merged?: boolean
  mergedAt?: string
  draft?: boolean
  url?: string
  author?: string
  authorType?: string
  headBranch?: string
  baseBranch?: string
  headSha?: string
  labels?: string[]
  createdByGitHubApp?: boolean
  createdAt?: string
  githubUpdatedAt?: string
  updatedAt?: string
  lastEvent?: string
  lastAction?: string
  checkStatus?: string
  checkConclusion?: string
  checkName?: string
  checkUrl?: string
  combinedStatus?: string
  closedAt?: string
  comments?: number
  reviewComments?: number
  commits?: number
  additions?: number
  deletions?: number
  changedFiles?: number
  reactions?: {
    total?: number
    plusOne?: number
    minusOne?: number
    laugh?: number
    hooray?: number
    confused?: number
    heart?: number
    rocket?: number
    eyes?: number
  }
}

export type UserConfig = Record<string, unknown>

export type ChatSessionsResponse = {
  sessions: ChatSession[]
  activeSessionId?: string
}

export async function getAwsCredential(idToken: string): Promise<AwsCredentialMetadata> {
  const response = await request<{ credential: AwsCredentialMetadata }>("/aws-credential", idToken)
  return response.credential
}

export async function listAwsCredentials(idToken: string): Promise<AwsCredentialsResponse> {
  return request<AwsCredentialsResponse>("/aws-credentials", idToken)
}

export async function saveAwsCredential(
  payload: AwsCredentialPayload,
  idToken: string
): Promise<AwsCredentialMetadata> {
  const response = await request<{ credential: AwsCredentialMetadata }>("/aws-credentials", idToken, {
    method: "POST",
    body: JSON.stringify(payload),
  })
  return response.credential
}

export async function listStateBackends(idToken: string): Promise<StateBackend[]> {
  const response = await request<{ backends: StateBackend[] }>("/resources/state-backends", idToken)
  return response.backends
}

export async function createStateBackend(
  payload: StateBackendPayload,
  idToken: string
): Promise<StateBackend> {
  const response = await request<{ backend: StateBackend }>("/resources/state-backends", idToken, {
    method: "POST",
    body: JSON.stringify(payload),
  })
  return response.backend
}

export async function listStateBackendResources(
  backendId: string,
  idToken: string
): Promise<StateBackendResource[]> {
  const response = await request<{ resources: StateBackendResource[] }>(
    `/resources/state-backends/${encodeURIComponent(backendId)}/resources`,
    idToken
  )
  return response.resources
}

export async function listS3Buckets(
  payload: { credentialId: string; region: string },
  idToken: string
): Promise<S3BucketInfo[]> {
  const query = new URLSearchParams({
    credentialId: payload.credentialId,
    region: payload.region,
  })
  const response = await request<{ buckets: S3BucketInfo[] }>(
    `/resources/s3-buckets?${query.toString()}`,
    idToken
  )
  return response.buckets
}

export async function saveBackendPlan(
  backendId: string,
  plan: Record<string, unknown>,
  idToken: string
): Promise<StateBackend> {
  const response = await request<{ backend: StateBackend }>(
    `/resources/state-backends/${encodeURIComponent(backendId)}/plan`,
    idToken,
    {
      method: "POST",
      body: JSON.stringify({ plan }),
    }
  )
  return response.backend
}

export async function listResourceScans(idToken: string): Promise<ResourceScan[]> {
  const response = await request<{ scans: ResourceScan[] }>("/resources/scans", idToken)
  return response.scans
}

export async function startResourceScan(
  backendId: string,
  idToken: string
): Promise<ResourceScan> {
  const response = await request<{ scan: ResourceScan }>("/resources/scans", idToken, {
    method: "POST",
    body: JSON.stringify({ backendId }),
  })
  return response.scan
}

export async function listDriftGuards(idToken: string): Promise<DriftGuard[]> {
  const response = await request<{ guards: DriftGuard[] }>("/resources/drift-guards", idToken)
  return response.guards
}

export async function saveDriftGuard(
  payload: DriftGuardPayload,
  idToken: string
): Promise<DriftGuard> {
  const response = await request<{ guard: DriftGuard }>("/resources/drift-guards", idToken, {
    method: "POST",
    body: JSON.stringify(payload),
  })
  return response.guard
}

export async function runDriftGuard(
  guardId: string,
  idToken: string
): Promise<{ scan?: ResourceScan; skipped?: boolean; reason?: string }> {
  return request<{ scan?: ResourceScan; skipped?: boolean; reason?: string }>(
    `/resources/drift-guards/${encodeURIComponent(guardId)}/run`,
    idToken,
    { method: "POST" }
  )
}

export async function getResourceScanLogs(
  scanId: string,
  idToken: string,
  nextToken?: string | null
): Promise<ResourceScanLogs> {
  const query = nextToken ? `?nextToken=${encodeURIComponent(nextToken)}` : ""
  const response = await request<{ logs: ResourceScanLogs }>(
    `/resources/scans/${encodeURIComponent(scanId)}/logs${query}`,
    idToken
  )
  return response.logs
}

export async function getStateBackendGraphUrl(backendId: string, idToken: string): Promise<ResourceGraphUrl> {
  const response = await request<{ graph: ResourceGraphUrl }>(
    `/resources/state-backends/${encodeURIComponent(backendId)}/graph`,
    idToken
  )
  return response.graph
}

export async function listTerraformPlanJobs(idToken: string): Promise<TerraformPlanJob[]> {
  const response = await request<{ jobs: TerraformPlanJob[] }>("/resources/terraform-plans", idToken)
  return response.jobs
}

export async function startTerraformPlanJob(
  payload: StateBackendPayload & { files: TerraformSourceFile[] },
  idToken: string
): Promise<{ job: TerraformPlanJob; backend: StateBackend }> {
  return request<{ job: TerraformPlanJob; backend: StateBackend }>("/resources/terraform-plans", idToken, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export async function listGitHubPullRequests(
  repository: string,
  state: "open" | "closed" | "merged" | "all",
  idToken: string
): Promise<GitHubPullRequestStatus[]> {
  const query = new URLSearchParams({ repository, state })
  const response = await request<{ pullRequests: GitHubPullRequestStatus[] }>(
    `/github/pull-requests?${query.toString()}`,
    idToken
  )
  return response.pullRequests
}

export async function listChatSessions(idToken: string): Promise<ChatSessionsResponse> {
  return request<ChatSessionsResponse>("/user/chat-sessions", idToken)
}

export async function saveChatSessions(
  payload: ChatSessionsResponse,
  idToken: string
): Promise<ChatSessionsResponse> {
  return request<ChatSessionsResponse>("/user/chat-sessions", idToken, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export async function deleteChatSession(
  sessionId: string,
  idToken: string
): Promise<ChatSessionsResponse> {
  return request<ChatSessionsResponse>(`/user/chat-sessions/${encodeURIComponent(sessionId)}`, idToken, {
    method: "DELETE",
  })
}

export async function getUserConfig(idToken: string): Promise<UserConfig> {
  const response = await request<{ config: UserConfig }>("/user/config", idToken)
  return response.config
}

export async function saveUserConfig(key: string, value: unknown, idToken: string): Promise<void> {
  await request<{ config: unknown }>("/user/config", idToken, {
    method: "POST",
    body: JSON.stringify({ key, value }),
  })
}
