"use client"

import { useState } from "react"
import { Wrench, Loader2, ChevronRight, ChevronDown, ExternalLink, CircleStop, CheckCircle2 } from "lucide-react"
import type { ToolRenderProps } from "@/hooks/useToolRenderer"
import type { ToolProgressEntry } from "./types"

type DiagramSuccess = {
  ok?: boolean
  public_url: string
  public_url_expires_in?: number | null
  image_key?: string
  image_path?: string
  source_path?: string
  mime_type?: string
}

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

function isDiagramSuccess(diagram: ReturnType<typeof parseDiagramResult>): diagram is DiagramSuccess {
  return Boolean(diagram && "public_url" in diagram && diagram.public_url)
}

export function ToolCallDisplay({ name, args, status, progress, result, agent }: ToolRenderProps) {
  const [expanded, setExpanded] = useState(false)
  const diagram = parseDiagramResult(name, result)
  const activity = normalizeProgress(progress)
  const displayName = formatToolDisplayName(name)
  const latestActivity = activity.length > 0 ? activity[activity.length - 1] : undefined
  const statusText = latestActivity ? stripToolPrefix(latestActivity.message, name, agent?.name) : formatToolStatus(status)

  return (
    <div className="my-1 text-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left transition-colors hover:bg-slate-100"
      >
        {expanded ? (
          <ChevronDown size={12} className="text-gray-400" />
        ) : (
          <ChevronRight size={12} className="text-gray-400" />
        )}
        <Wrench size={12} className="text-gray-400" />
        <span className="min-w-0 flex-1 truncate text-slate-600">
          <span className="font-medium text-slate-700">{displayName}</span>
          {statusText && <span className="text-slate-500"> {statusText}</span>}
        </span>
        {status === "streaming" && (
          <Loader2 size={12} className="animate-spin text-blue-500 ml-auto" />
        )}
        {status === "executing" && (
          <Loader2 size={12} className="animate-spin text-amber-500 ml-auto" />
        )}
        {status === "complete" && <CheckCircle2 size={12} className="text-emerald-500 ml-auto" />}
        {status === "stopped" && <CircleStop size={12} className="text-slate-400 ml-auto" />}
      </button>

      {activity.length > 0 && (status === "streaming" || status === "executing") && (
        <div className="ml-6 mt-1 space-y-1 border-l-2 border-sky-100 pl-3 text-xs text-slate-500">
          {activity.slice(-3).map((item, index) => (
            <div key={`${index}-${item.phase}-${item.message}`} className="flex items-start gap-1.5">
              <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin text-sky-500" />
              <span className="break-words">{item.message}</span>
            </div>
          ))}
        </div>
      )}

      {isDiagramSuccess(diagram) && <DiagramResultFigure diagram={diagram} />}

      {expanded && (
        <div className="ml-6 mt-1 space-y-2 border-l-2 border-slate-200 pl-3">
          {activity.length > 0 && (
            <div>
              <div className="text-xs text-slate-400">Agent reasoning and tools</div>
              <div className="mt-1 space-y-1.5">
                {activity.map((item, index) => (
                  <div key={`${index}-${item.phase}-${item.message}`} className="flex items-start gap-2 text-xs">
                    <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-medium ${progressPhaseClass(item.phase)}`}>
                      {progressPhaseLabel(item.phase)}
                    </span>
                    <span className="min-w-0 whitespace-pre-wrap break-words text-slate-600">
                      {item.message}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {args && (
            <div>
              <div className="text-xs text-slate-400">Input</div>
              <pre className="mt-0.5 whitespace-pre-wrap break-words text-xs text-slate-600">
                {args}
              </pre>
            </div>
          )}
          {result && (
            <div>
              <div className="text-xs text-slate-400">Result</div>
              <pre className="mt-0.5 whitespace-pre-wrap break-words text-xs text-slate-600">
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

function formatToolDisplayName(name: string) {
  const normalized = name.toLowerCase()
  if (normalized.includes("architect")) return "Architecture"
  if (normalized === "diagram") return "Diagram"
  return name
    .replace(/_agent$/i, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, letter => letter.toUpperCase())
}

function formatToolStatus(status: string) {
  switch (status) {
    case "streaming":
      return "is preparing..."
    case "executing":
      return "is working..."
    case "stopped":
      return "stopped"
    case "complete":
      return "completed"
    default:
      return ""
  }
}

function stripToolPrefix(message: string, name: string, agentName?: string) {
  const prefixes = [name, agentName].filter(Boolean) as string[]
  for (const prefix of prefixes) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const pattern = new RegExp(`^${escaped}\\s+`, "i")
    if (pattern.test(message)) {
      return message.replace(pattern, "")
    }
  }
  return message
}

function DiagramResultFigure({
  diagram,
}: {
  diagram: DiagramSuccess
}) {
  return (
    <figure className="my-2 overflow-hidden rounded-lg border border-slate-200 bg-white">
      <img
        src={diagram.public_url}
        alt="Rendered architecture diagram"
        className="max-h-[520px] w-full object-contain"
      />
      {(diagram.image_path || diagram.public_url) && (
        <figcaption className="flex items-center justify-between gap-2 border-t border-slate-200 px-2 py-1 text-xs text-slate-500">
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
      return "bg-slate-100 text-slate-600"
  }
}
