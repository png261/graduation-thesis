import type { ChatSession } from "./types"

export function isEmptyNewChatSession(session: ChatSession): boolean {
  return !session.repository && !session.pullRequest && (session.history?.length ?? 0) === 0
}
