"use client"

import { useState } from "react"
import { Check, Copy, Pencil } from "lucide-react"
import { Message } from "./types"
import { getToolRenderer } from "@/hooks/useToolRenderer"
import { MarkdownRenderer } from "./MarkdownRenderer"

interface ChatMessageProps {
  message: Message
  canEdit?: boolean
  editDisabledReason?: string
  onEdit?: () => void
}

export function ChatMessage({
  message,
  canEdit = false,
  editDisabledReason,
  onEdit,
}: ChatMessageProps) {
  const [copied, setCopied] = useState(false)
  const canCopyAssistantResponse = message.role === "assistant" && message.status === "complete" && Boolean(message.content)

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
              progress: seg.toolCall.progress,
              result: seg.toolCall.result,
              agent: message.agent,
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
    <div className={`group/message flex flex-col ${message.role === "user" ? "items-end" : "items-start"}`}>
      <div className={`max-w-[80%] break-words ${message.role === "user" ? "text-[15px] leading-6 text-slate-950" : "text-slate-950"}`}>
        {message.role === "assistant" ? (
          renderAssistantContent()
        ) : (
          <div className="flex flex-col items-end gap-2">
            {message.attachments && message.attachments.length > 0 && (
              <div className="flex flex-wrap justify-end gap-2">
                {message.attachments.map(attachment => (
                  <div
                    key={attachment.id}
                    className="max-w-[260px] overflow-hidden rounded-xl border border-slate-200 bg-transparent text-xs text-slate-700"
                  >
                    {attachment.type.startsWith("image/") && attachment.dataUrl ? (
                      <img
                        src={attachment.dataUrl}
                        alt={attachment.name}
                        className="max-h-56 w-full object-cover"
                      />
                    ) : attachment.type.startsWith("image/") ? (
                      <div className="bg-slate-100 px-3 py-2 text-slate-500">Image preview unavailable</div>
                    ) : (
                      <div className="truncate bg-slate-100 px-2 py-1">{attachment.name}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {message.content && (
              <div className="rounded-[1.35rem] bg-[#f4f4f4] px-4 py-2.5 whitespace-pre-wrap">
                {message.content}
              </div>
            )}
          </div>
        )}
      </div>

      {(canCopyAssistantResponse || (message.role === "user" && onEdit)) && (
        <div className="mt-1 flex items-center gap-2 px-1 opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100">
          {canCopyAssistantResponse && (
            <button
              onClick={() => void handleCopyResponse()}
              className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950"
              aria-label="Copy response"
              title={copied ? "Copied" : "Copy response"}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          )}
          {message.role === "user" && onEdit && (
            <button
              type="button"
              onClick={onEdit}
              disabled={!canEdit}
              className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-500"
              aria-label="Edit message"
              title={!canEdit && editDisabledReason ? editDisabledReason : "Edit message"}
            >
              <Pencil size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ThinkingIndicator() {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-500"
      role="status"
      aria-live="polite"
      aria-label="thinking"
    >
      <span>Agent is responding</span>
      <span className="inline-flex items-center gap-1" aria-hidden="true">
        <span className="h-1.5 w-1.5 animate-[thinking-dot_1.2s_ease-in-out_infinite] rounded-full bg-slate-400" />
        <span className="h-1.5 w-1.5 animate-[thinking-dot_1.2s_ease-in-out_0.15s_infinite] rounded-full bg-slate-400" />
        <span className="h-1.5 w-1.5 animate-[thinking-dot_1.2s_ease-in-out_0.3s_infinite] rounded-full bg-slate-400" />
      </span>
      <style>{`
        @keyframes thinking-dot {
          0%, 80%, 100% { opacity: 0.35; transform: translateY(0); }
          40% { opacity: 1; transform: translateY(-2px); }
        }
      `}</style>
    </span>
  )
}
