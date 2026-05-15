import { RefObject } from "react"
import { Message } from "./types"
import { ChatMessage } from "./ChatMessage"

export type UserMessageEditState = {
  canEdit: boolean
  reason?: string
}

interface ChatMessagesProps {
  messages: Message[]
  messagesContainerRef: RefObject<HTMLDivElement | null>
  messagesEndRef: RefObject<HTMLDivElement | null>
  onScroll?: () => void
  getUserMessageEditState?: (messageIndex: number) => UserMessageEditState
  onEditUserMessage?: (messageIndex: number) => void
}

export function ChatMessages({
  messages,
  messagesContainerRef,
  messagesEndRef,
  onScroll,
  getUserMessageEditState,
  onEditUserMessage,
}: ChatMessagesProps) {
  return (
    <div
      ref={messagesContainerRef}
      onScroll={onScroll}
      data-testid="chat-messages"
      className={`flex h-full w-full flex-col gap-4 bg-white p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
        messages.length > 0 ? "overflow-y-auto" : "overflow-hidden"
      }`}
    >
      {messages.length === 0 ? (
        <div className="flex h-full items-center justify-center text-neutral-500">
          Start a new conversation
        </div>
      ) : (
        messages.map((message, index) => {
          const editState = message.role === "user"
            ? getUserMessageEditState?.(index)
            : undefined
          return (
            <ChatMessage
              key={index}
              message={message}
              canEdit={editState?.canEdit}
              editDisabledReason={editState?.reason}
              onEdit={message.role === "user" && onEditUserMessage ? () => onEditUserMessage(index) : undefined}
            />
          )
        })
      )}
      <div ref={messagesEndRef} />
    </div>
  )
}
