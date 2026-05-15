import { RefObject } from "react"
import { Message } from "./types"
import { ChatMessage } from "./ChatMessage"

interface ChatMessagesProps {
  messages: Message[]
  messagesContainerRef: RefObject<HTMLDivElement | null>
  messagesEndRef: RefObject<HTMLDivElement | null>
  onScroll?: () => void
}

export function ChatMessages({
  messages,
  messagesContainerRef,
  messagesEndRef,
  onScroll,
}: ChatMessagesProps) {
  return (
    <div
      ref={messagesContainerRef}
      onScroll={onScroll}
      data-testid="chat-messages"
      className={`flex h-full w-full flex-col gap-4 bg-white p-4 pb-36 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
        messages.length > 0 ? "overflow-y-auto" : "overflow-hidden"
      }`}
    >
      {messages.length === 0 ? (
        <div className="flex h-full items-center justify-center text-neutral-500">
          Start a new conversation
        </div>
      ) : (
        messages.map((message, index) => (
          <ChatMessage
            key={index}
            message={message}
          />
        ))
      )}
      <div ref={messagesEndRef} />
    </div>
  )
}
