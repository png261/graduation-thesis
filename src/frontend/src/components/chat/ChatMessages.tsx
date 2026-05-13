import { RefObject } from "react"
import { Message } from "./types"
import { ChatMessage } from "./ChatMessage"

interface ChatMessagesProps {
  messages: Message[]
  messagesEndRef: RefObject<HTMLDivElement | null>
}

export function ChatMessages({
  messages,
  messagesEndRef,
}: ChatMessagesProps) {
  return (
    <div
      className={`flex h-full w-full flex-col gap-4 bg-white p-4 pb-36 ${
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
