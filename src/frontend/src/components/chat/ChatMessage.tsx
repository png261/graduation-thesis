"use client"

import { useState } from "react"
import { Check, Copy, ThumbsDown, ThumbsUp } from "lucide-react"
import { Message } from "./types"
import { FeedbackDialog } from "./FeedbackDialog"
import { getToolRenderer } from "@/hooks/useToolRenderer"
import { MarkdownRenderer } from "./MarkdownRenderer"
import { ShinyText } from "@/components/ui/shiny-text"

interface ChatMessageProps {
  message: Message
  sessionId: string
  onFeedbackSubmit: (feedbackType: "positive" | "negative", comment: string) => Promise<void>
}

export function ChatMessage({
  message,
  onFeedbackSubmit,
}: ChatMessageProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [selectedFeedbackType, setSelectedFeedbackType] = useState<"positive" | "negative">(
    "positive"
  )
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false)
  const [copied, setCopied] = useState(false)

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const handleFeedbackClick = (type: "positive" | "negative") => {
    setSelectedFeedbackType(type)
    setIsDialogOpen(true)
  }

  const handleFeedbackSubmit = async (comment: string) => {
    await onFeedbackSubmit(selectedFeedbackType, comment)
    setFeedbackSubmitted(true)
  }

  const handleCopyResponse = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error("Failed to copy response:", error)
    }
  }

  const renderAssistantContent = () => {
    // If segments exist, render them in order (interleaved text + tools)
    if (message.segments && message.segments.length > 0) {
      return message.segments.map((seg, i) => {
        if (seg.type === "text") {
          return <MarkdownRenderer key={i} content={seg.content} />
        }
        const render = getToolRenderer(seg.toolCall.name)
        if (!render) return null
        return (
          <div key={seg.toolCall.toolUseId} className="my-1">
            {render({
              name: seg.toolCall.name,
              args: seg.toolCall.input,
              status: seg.toolCall.status,
              result: seg.toolCall.result,
            })}
          </div>
        )
      })
    }
    if (message.content === "Thinking...") {
      return <ThinkingIndicator />
    }
    // Fallback: just render content as markdown
    return <MarkdownRenderer content={message.content} />
  }

  return (
    <div className={`flex flex-col ${message.role === "user" ? "items-end" : "items-start"}`}>
      {message.role === "assistant" && message.agent && (
        <div className="mb-1 flex items-center gap-2 px-1">
          <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold ${message.agent.className}`}>
            {message.agent.avatar}
          </span>
          <span className="text-xs font-medium text-slate-600">{message.agent.name}</span>
        </div>
      )}
      <div
        className={`max-w-[80%] break-words ${
          message.role === "user"
            ? "rounded-lg rounded-br-none bg-slate-950 p-3 text-white whitespace-pre-wrap"
            : "text-slate-950"
        }`}
      >
        {message.role === "assistant" ? (
          renderAssistantContent()
        ) : (
          <div className="flex flex-col gap-2">
            {message.content && <div>{message.content}</div>}
            {message.attachments && message.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {message.attachments.map(attachment => (
                  <div
                    key={attachment.id}
                    className="max-w-[220px] overflow-hidden rounded-md border border-white/20 bg-white/10 text-xs"
                  >
                    {attachment.type.startsWith("image/") ? (
                      <img
                        src={attachment.dataUrl}
                        alt={attachment.name}
                        className="max-h-40 w-full object-cover"
                      />
                    ) : null}
                    <div className="truncate px-2 py-1">{attachment.name}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Timestamp and Feedback buttons for assistant messages */}
      <div className="flex items-center gap-2 mt-1 px-1">
        <div className="text-xs text-neutral-500">{formatTime(message.timestamp)}</div>

        {/* Show feedback buttons only for assistant messages with content */}
        {message.role === "assistant" && message.content && (
          <div className="flex items-center gap-1 ml-2">
            <button
              onClick={() => void handleCopyResponse()}
              className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950"
              aria-label="Copy response"
              title={copied ? "Copied" : "Copy response"}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
            <button
              onClick={() => handleFeedbackClick("positive")}
              disabled={feedbackSubmitted}
              className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Positive feedback"
              title="Good response"
            >
              <ThumbsUp size={14} />
            </button>
            <button
              onClick={() => handleFeedbackClick("negative")}
              disabled={feedbackSubmitted}
              className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Negative feedback"
              title="Bad response"
            >
              <ThumbsDown size={14} />
            </button>
            {feedbackSubmitted && (
              <span className="ml-1 text-xs text-neutral-500">Thanks for your feedback!</span>
            )}
          </div>
        )}
      </div>

      {/* Feedback Dialog */}
      <FeedbackDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onSubmit={handleFeedbackSubmit}
        feedbackType={selectedFeedbackType}
      />
    </div>
  )
}

function ThinkingIndicator() {
  return (
    <span
      className="inline-flex items-baseline px-1 text-sm font-medium text-slate-500"
      role="status"
      aria-live="polite"
      aria-label="thinking"
    >
      <ShinyText text="thinking" shineColor="#dd1616" speed={3.2} />
      <span className="relative ml-0.5 inline-block w-4 overflow-hidden align-baseline">
        <span className="animate-[thinking-dots_1.2s_steps(3,end)_infinite]">...</span>
      </span>
      <style>{`
        @keyframes thinking-dots {
          0% { width: 0; }
          100% { width: 1rem; }
        }
      `}</style>
    </span>
  )
}
