"use client"

import { useState } from "react"
import { Wrench, Loader2, CheckCircle2, ChevronRight, ChevronDown, ExternalLink, CircleStop } from "lucide-react"
import type { ToolRenderProps } from "@/hooks/useToolRenderer"
import type { ToolProgressEntry } from "./types"

export function parseDiagramResult(name: string, result?: string) {
  if (name !== "diagram" || !result) return null
  try {
    const parsed = JSON.parse(result) as {
      ok?: boolean
      public_url?: string
      public_url_expires_in?: number | null
      image_key?: string
      image_path?: string
      source_path?: string
      mime_type?: string
      error?: string
    }
    if (!parsed.ok) return parsed.error ? { error: parsed.error } : null
    if (!parsed.public_url?.startsWith("http")) return null
    return parsed
  } catch {
    return null
  }
}

export function ToolCallDisplay({ name, args, status, progress, result, agent }: ToolRenderProps) {
  const [expanded, setExpanded] = useState(false)
  const diagram = parseDiagramResult(name, result)
  const activity = normalizeProgress(progress)

  return (
    <div className="my-1 text-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-gray-200/50 transition-colors w-full text-left"
      >
        {expanded ? (
          <ChevronDown size={12} className="text-gray-400" />
        ) : (
          <ChevronRight size={12} className="text-gray-400" />
        )}
        <Wrench size={12} className="text-gray-400" />
        {agent && (
          <span className="ml-0.5 inline-flex min-w-0 items-center gap-1.5">
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold ${agent.className}`}>
              {agent.avatar}
            </span>
            <span className="max-w-[160px] truncate text-xs font-medium text-slate-600">{agent.name}</span>
          </span>
        )}
        <span className="text-gray-600">{name}</span>
        {status === "streaming" && (
          <Loader2 size={12} className="animate-spin text-blue-500 ml-auto" />
        )}
        {status === "executing" && (
          <Loader2 size={12} className="animate-spin text-amber-500 ml-auto" />
        )}
        {status === "complete" && <CheckCircle2 size={12} className="text-green-500 ml-auto" />}
        {status === "stopped" && <CircleStop size={12} className="text-slate-400 ml-auto" />}
      </button>

      {activity.length > 0 && status !== "complete" && status !== "stopped" && (
        <div className="ml-6 mt-1 space-y-1 border-l-2 border-sky-100 pl-3 text-xs text-slate-500">
          {activity.slice(-3).map((item, index) => (
            <div key={`${index}-${item.phase}-${item.message}`} className="flex items-start gap-1.5">
              <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin text-sky-500" />
              <span className="break-words">{item.message}</span>
            </div>
          ))}
        </div>
      )}

      {diagram && "public_url" in diagram && (
        <figure className="my-2 overflow-hidden rounded border border-gray-200 bg-white">
          <img
            src={diagram.public_url}
            alt="Rendered architecture diagram"
            className="max-h-[520px] w-full object-contain"
          />
          {(diagram.image_path || diagram.public_url) && (
            <figcaption className="flex items-center justify-between gap-2 border-t border-gray-200 px-2 py-1 text-xs text-gray-500">
              <span className="min-w-0 truncate">{diagram.image_path}</span>
              <a
                className="inline-flex shrink-0 items-center gap-1 text-sky-700 underline"
                href={diagram.public_url}
                rel="noreferrer"
                target="_blank"
              >
                Open
                <ExternalLink className="h-3 w-3" />
              </a>
            </figcaption>
          )}
        </figure>
      )}

      {expanded && (
        <div className="ml-6 mt-1 border-l-2 border-gray-200 pl-3 space-y-2">
          {activity.length > 0 && (
            <div>
              <div className="text-xs text-gray-400">Agent reasoning and tools</div>
              <div className="mt-1 space-y-1.5">
                {activity.map((item, index) => (
                  <div key={`${index}-${item.phase}-${item.message}`} className="flex items-start gap-2 text-xs">
                    <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-medium ${progressPhaseClass(item.phase)}`}>
                      {progressPhaseLabel(item.phase)}
                    </span>
                    <span className="min-w-0 whitespace-pre-wrap break-words text-gray-600">
                      {item.message}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {args && (
            <div>
              <div className="text-xs text-gray-400">Input</div>
              <pre className="text-xs text-gray-600 whitespace-pre-wrap break-words mt-0.5">
                {args}
              </pre>
            </div>
          )}
          {result && (
            <div>
              <div className="text-xs text-gray-400">Result</div>
              <pre className="text-xs text-gray-600 whitespace-pre-wrap break-words mt-0.5">
                {diagram && "public_url" in diagram
                  ? JSON.stringify(
                      {
                        ok: true,
                        public_url: diagram.public_url,
                        public_url_expires_in: diagram.public_url_expires_in,
                        image_key: diagram.image_key,
                        image_path: diagram.image_path,
                        source_path: diagram.source_path,
                        mime_type: diagram.mime_type,
                      },
                      null,
                      2
                    )
                  : result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function normalizeProgress(progress?: ToolProgressEntry[]) {
  return (progress ?? [])
    .map(item => {
      if (typeof item === "string") {
        return { phase: "", message: item }
      }
      return {
        phase: item.phase || "",
        message: item.message || "",
      }
    })
    .filter(item => item.message.trim().length > 0)
}

function progressPhaseLabel(phase: string) {
  switch (phase) {
    case "started":
      return "Started"
    case "thinking":
      return "Thinking"
    case "tool":
      return "Tool"
    case "text":
      return "Reasoning"
    case "completed":
      return "Done"
    default:
      return "Update"
  }
}

function progressPhaseClass(phase: string) {
  switch (phase) {
    case "tool":
      return "bg-amber-50 text-amber-700"
    case "text":
      return "bg-sky-50 text-sky-700"
    case "completed":
      return "bg-emerald-50 text-emerald-700"
    case "started":
    case "thinking":
      return "bg-slate-100 text-slate-600"
    default:
      return "bg-gray-100 text-gray-600"
  }
}
