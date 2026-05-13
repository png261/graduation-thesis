/** Configuration for AgentCoreClient */
export interface AgentCoreConfig {
  runtimeArn: string
  region?: string
}

export type SelectedRepository = {
  fullName: string
  owner: string
  name: string
  defaultBranch: string
  url?: string
}

export type ChatAgentPayload = {
  id: "agent1"
  mention: "@devops"
  name: string
  avatar: string
  className: string
}

export type ChatAttachmentPayload = {
  id: string
  name: string
  type: string
  size: number
  dataUrl: string
}

export type UserHandoffPayload = {
  type: "user_handoff"
  questions: Array<{
    id: string
    question: string
    options: string[]
  }>
}

/** Stream event types emitted by parsers */
export type StreamEvent =
  | { type: "text"; content: string }
  | { type: "tool_use_start"; toolUseId: string; name: string }
  | { type: "tool_use_delta"; toolUseId: string; input: string }
  | { type: "tool_use_input_snapshot"; toolUseId: string; input: string }
  | { type: "tool_result"; toolUseId: string; result: string }
  | { type: "message"; role: string; content: unknown[] }
  | { type: "result"; stopReason: string }
  | { type: "lifecycle"; event: string }
  | { type: "pull_request"; pullRequest: unknown }
  | { type: "session_title"; title: string }
  | { type: "agent"; agent: ChatAgentPayload }
  | { type: "user_handoff"; handoff: UserHandoffPayload }

/** Callback invoked with each stream event */
export type StreamCallback = (event: StreamEvent) => void

/** Parses a single SSE line and emits events via callback */
export type ChunkParser = (line: string, callback: StreamCallback) => void
