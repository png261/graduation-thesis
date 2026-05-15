import type { AgentCoreConfig, ChatAttachmentPayload, ChunkParser, SelectedRepository, SelectedStateBackend, StreamCallback } from "./types"
import { parseStrandsChunk } from "./parsers/strands"
import { readSSEStream } from "./utils/sse"

export class AgentCoreClient {
  private runtimeArn: string
  private region: string
  private parser: ChunkParser

  constructor(config: AgentCoreConfig) {
    this.runtimeArn = config.runtimeArn
    this.region = config.region ?? "ap-southeast-1"
    this.parser = parseStrandsChunk
  }

  generateSessionId(): string {
    return crypto.randomUUID()
  }

  async invoke(
    query: string,
    sessionId: string,
    accessToken: string,
    onEvent: StreamCallback,
    repository?: SelectedRepository | null,
    attachments?: ChatAttachmentPayload[],
    stateBackend?: SelectedStateBackend | null,
    signal?: AbortSignal
  ): Promise<void> {
    if (!accessToken) throw new Error("No valid access token found.")
    if (!this.runtimeArn) throw new Error("Agent Runtime ARN not configured.")

    const endpoint = `https://bedrock-agentcore.${this.region}.amazonaws.com`
    const escapedArn = encodeURIComponent(this.runtimeArn)
    const url = `${endpoint}/runtimes/${escapedArn}/invocations?qualifier=DEFAULT`

    const traceId = `1-${Math.floor(Date.now() / 1000).toString(16)}-${crypto.randomUUID()}`

    const body = {
      prompt: query,
      runtimeSessionId: sessionId,
      repository,
      attachments,
      stateBackend,
    }

    // User identity is extracted server-side from the validated JWT token
    // (Authorization header), not sent in the payload body. This prevents
    // impersonation via prompt injection.
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Amzn-Trace-Id": traceId,
        "Content-Type": "application/json",
        "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": sessionId,
      },
      body: JSON.stringify(body),
      signal,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`HTTP ${response.status}: ${errorText}`)
    }

    await readSSEStream(response, this.parser, onEvent)
  }

  async cancelSession(sessionId: string, accessToken: string): Promise<void> {
    if (!accessToken) throw new Error("No valid access token found.")
    if (!this.runtimeArn) throw new Error("Agent Runtime ARN not configured.")

    const endpoint = `https://bedrock-agentcore.${this.region}.amazonaws.com`
    const escapedArn = encodeURIComponent(this.runtimeArn)
    const url = `${endpoint}/runtimes/${escapedArn}/invocations?qualifier=DEFAULT`
    const traceId = `1-${Math.floor(Date.now() / 1000).toString(16)}-${crypto.randomUUID()}`

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Amzn-Trace-Id": traceId,
        "Content-Type": "application/json",
        "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": sessionId,
      },
      body: JSON.stringify({
        prompt: "cancelSession",
        runtimeSessionId: sessionId,
        controlAction: "cancelSession",
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`HTTP ${response.status}: ${errorText}`)
    }
  }

  async githubAction(
    action:
      | "previewPullRequest"
      | "createPullRequest"
      | "getFileDiff"
      | "generateTerraformGraph"
      | "listPullRequests"
      | "listInstalledRepositories"
      | "setupRepositoryWorkspace",
    sessionId: string,
    accessToken: string,
    repository?: SelectedRepository | null,
    pullRequest?: { title?: string; body?: string },
    options?: {
      filePath?: string
      pullRequestState?: "open" | "closed" | "all"
      terraformPath?: string
      stateBackend?: SelectedStateBackend | null
    }
  ): Promise<unknown> {
    if (!accessToken) throw new Error("No valid access token found.")
    if (!this.runtimeArn) throw new Error("Agent Runtime ARN not configured.")

    const endpoint = `https://bedrock-agentcore.${this.region}.amazonaws.com`
    const escapedArn = encodeURIComponent(this.runtimeArn)
    const url = `${endpoint}/runtimes/${escapedArn}/invocations?qualifier=DEFAULT`
    const traceId = `1-${Math.floor(Date.now() / 1000).toString(16)}-${crypto.randomUUID()}`

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Amzn-Trace-Id": traceId,
        "Content-Type": "application/json",
        "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": sessionId,
      },
      body: JSON.stringify({
        prompt: action,
        runtimeSessionId: sessionId,
        githubAction: action,
        repository: repository ?? undefined,
        filePath: options?.filePath,
        terraformPath: options?.terraformPath,
        stateBackend: options?.stateBackend ?? undefined,
        pullRequest,
        pullRequestState: options?.pullRequestState,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`HTTP ${response.status}: ${errorText}`)
    }

    const text = await response.text()
    const lines = text.split("\n").filter(line => line.startsWith("data: "))
    const last = lines.length > 0 ? lines[lines.length - 1].replace(/^data:\s*/, "") : undefined
    if (!last) return null
    const parsed = JSON.parse(last)
    if (parsed && typeof parsed === "object" && "status" in parsed && parsed.status === "error") {
      throw new Error(parsed.error || `${action} failed`)
    }
    return parsed
  }

  async filesystemAction(
    action: "listFiles" | "getFileContent",
    sessionId: string,
    accessToken: string,
    repository?: SelectedRepository | null,
    options?: { prefix?: string; fileKey?: string }
  ): Promise<unknown> {
    if (!accessToken) throw new Error("No valid access token found.")
    if (!this.runtimeArn) throw new Error("Agent Runtime ARN not configured.")

    const endpoint = `https://bedrock-agentcore.${this.region}.amazonaws.com`
    const escapedArn = encodeURIComponent(this.runtimeArn)
    const url = `${endpoint}/runtimes/${escapedArn}/invocations?qualifier=DEFAULT`
    const traceId = `1-${Math.floor(Date.now() / 1000).toString(16)}-${crypto.randomUUID()}`

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Amzn-Trace-Id": traceId,
        "Content-Type": "application/json",
        "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": sessionId,
      },
      body: JSON.stringify({
        prompt: action,
        runtimeSessionId: sessionId,
        filesystemAction: action,
        repository: repository ?? undefined,
        prefix: options?.prefix,
        fileKey: options?.fileKey,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`HTTP ${response.status}: ${errorText}`)
    }

    const text = await response.text()
    const lines = text.split("\n").filter(line => line.startsWith("data: "))
    const last = lines.length > 0 ? lines[lines.length - 1].replace(/^data:\s*/, "") : undefined
    if (!last) return null
    const parsed = JSON.parse(last)
    if (parsed && typeof parsed === "object" && "status" in parsed && parsed.status === "error") {
      throw new Error(parsed.error || `${action} failed`)
    }
    return parsed
  }
}
