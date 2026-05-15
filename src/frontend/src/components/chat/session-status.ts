import type { ChatSession, Message } from "./types"

export function isPendingAssistantMessage(message: Message | undefined) {
  return Boolean(
    message &&
      message.role === "assistant" &&
      (message.status === "pending" || message.content === "Thinking...")
  )
}

export function hasPendingAssistantResponse(messages: Message[] | undefined) {
  return isPendingAssistantMessage(messages?.[messages.length - 1])
}

export function hasPendingSessionResponse(session: ChatSession) {
  return hasPendingAssistantResponse(session.history)
}
