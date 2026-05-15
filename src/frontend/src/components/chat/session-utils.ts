import type { ChatSession } from "./types"

export function isEmptyNewChatSession(session: ChatSession): boolean {
  return !session.repository && !session.stateBackend && !session.pullRequest && (session.history?.length ?? 0) === 0
}

export function hasFirstAgentResponse(session: ChatSession): boolean {
  return (session.history ?? []).some(message => {
    if (message.role !== "assistant") return false
    if ((message.segments?.length ?? 0) > 0) return true
    const content = message.content.trim()
    return content.length > 0 && content !== "Thinking..." && content !== "Stopped."
  })
}
