"use client"

import { useEffect, useState } from "react"
import { Check, Copy, Pencil } from "lucide-react"
import { Message } from "./types"
import { getToolRenderer } from "@/hooks/useToolRenderer"
import { MarkdownRenderer } from "./MarkdownRenderer"
import { ShinyText } from "@/components/ui/shiny-text"

interface ChatMessageProps {
  message: Message
  canEdit?: boolean
  editDisabledReason?: string
  onEdit?: () => void
}

export const THINKING_WORDS = [
  "beaming",
  "booping",
  "bouncing",
  "brewing",
  "bubbling",
  "chasing",
  "churning",
  "coalescing",
  "conjuring",
  "cooking",
  "crafting",
  "crunching",
  "cuddling",
  "dancing",
  "dazzling",
  "discovering",
  "doodling",
  "dreaming",
  "drifting",
  "enchanting",
  "exploring",
  "finding",
  "floating",
  "fluttering",
  "foraging",
  "forging",
  "frolicking",
  "gathering",
  "giggling",
  "gliding",
  "greeting",
  "growing",
  "hatching",
  "herding",
  "honking",
  "hopping",
  "hugging",
  "humming",
  "imagining",
  "inventing",
  "jingling",
  "juggling",
  "jumping",
  "kindling",
  "knitting",
  "launching",
  "leaping",
  "mapping",
  "marinating",
  "meandering",
  "mixing",
  "moseying",
  "munching",
  "napping",
  "nibbling",
  "noodling",
  "orbiting",
  "painting",
  "percolating",
  "petting",
  "plotting",
  "pondering",
  "popping",
  "prancing",
  "purring",
  "puzzling",
  "questing",
  "riding",
  "roaming",
  "rolling",
  "sauteeing",
  "scribbling",
  "seeking",
  "shimmying",
  "singing",
  "skipping",
  "sleeping",
  "snacking",
  "sniffing",
  "snuggling",
  "soaring",
  "sparking",
  "spinning",
  "splashing",
  "sprouting",
  "squishing",
  "stargazing",
  "stirring",
  "strolling",
  "swimming",
  "swinging",
  "tickling",
  "tinkering",
  "toasting",
  "tumbling",
  "twirling",
  "waddling",
  "wandering",
  "watching",
  "weaving",
  "whistling",
  "wibbling",
  "wiggling",
  "wishing",
  "wobbling",
  "wondering",
  "yawning",
  "zooming",
] as const

const THINKING_WORD_INTERVAL_MS = 1400

function randomThinkingWord(current?: string) {
  let next = THINKING_WORDS[Math.floor(Math.random() * THINKING_WORDS.length)]
  while (next === current) {
    next = THINKING_WORDS[Math.floor(Math.random() * THINKING_WORDS.length)]
  }
  return next
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
      <div
        className={`max-w-[80%] break-words ${
          message.role === "user"
            ? "rounded-[1.35rem] bg-[#f4f4f4] px-4 py-2.5 text-[15px] leading-6 text-slate-950 whitespace-pre-wrap"
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
                    className="max-w-[220px] overflow-hidden rounded-2xl border border-slate-200 bg-white text-xs text-slate-700"
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
  const [word, setWord] = useState(() => randomThinkingWord())

  useEffect(() => {
    const timer = window.setInterval(() => {
      setWord(current => randomThinkingWord(current))
    }, THINKING_WORD_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <span
      className="inline-flex items-baseline px-1 text-sm font-medium text-slate-500"
      role="status"
      aria-live="polite"
      aria-label="thinking"
    >
      <ShinyText text={word.toUpperCase()} shineColor="#dd1616" speed={3.2} />
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
