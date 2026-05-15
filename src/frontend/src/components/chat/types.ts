// Define message types
import type { SelectedRepository, SelectedStateBackend } from "@/lib/agentcore-client/types"

export type MessageRole = "user" | "assistant"

export interface ChatAgent {
  id: "agent1"
  name: string
  avatar: string
  className: string
}

export interface ChatAttachment {
  id: string
  name: string
  type: string
  size: number
  dataUrl: string
}

export interface UserHandoffQuestion {
  id: string
  question: string
  options: string[]
}

export interface UserHandoff {
  type: "user_handoff"
  questions: UserHandoffQuestion[]
}

export type ToolCallStatus = "streaming" | "executing" | "complete" | "stopped"

export type ToolProgressEntry =
  | string
  | {
      phase: string
      message: string
    }

export interface ToolCall {
  toolUseId: string
  name: string
  input: string
  progress?: ToolProgressEntry[]
  result?: string
  status: ToolCallStatus
}

export type MessageSegment =
  | { type: "text"; content: string }
  | { type: "tool"; toolCall: ToolCall }

export interface CheckpointState {
  restored?: boolean
  saved?: boolean
  error?: boolean
}

export interface Message {
  role: MessageRole
  content: string
  timestamp: string
  status?: "pending" | "complete" | "stopped" | "error"
  agent?: ChatAgent
  attachments?: ChatAttachment[]
  segments?: MessageSegment[]
  checkpoint?: CheckpointState
}

export type PullRequestInfo = {
  number?: number
  url?: string
  state?: string
  title?: string
  body?: string
  headBranch?: string
  baseBranch?: string
  created?: boolean
  updated?: boolean
  committed?: boolean
  commitTitle?: string
  message?: string
  error?: string
  changedFiles?: string[]
}

export interface ChatSession {
  id: string
  name: string
  history: Message[]
  startDate: string
  endDate: string
  pinned?: boolean
  repository?: SelectedRepository | null
  stateBackend?: SelectedStateBackend | null
  pullRequest?: PullRequestInfo | null
  pendingUserHandoff?: UserHandoff | null
}
