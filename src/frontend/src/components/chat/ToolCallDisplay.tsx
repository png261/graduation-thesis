"use client"

import { lazy, Suspense, useState } from "react"
import { Wrench, Loader2, CheckCircle2, ChevronRight, ChevronDown, ExternalLink } from "lucide-react"
import type { ToolRenderProps } from "@/hooks/useToolRenderer"
import type { ToolProgressEntry } from "./types"
import type { ExcalidrawElement, ExcalidrawView } from "./excalidraw-types"

const ExcalidrawSketch = lazy(() => import("./ExcalidrawSketch"))

export function parseDiagramResult(name: string, result?: string) {
  if (name !== "render_architecture_diagram" || !result) return null
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

export function parseExcalidrawView(name: string, result?: string, args?: string): ExcalidrawView | null {
  if (name !== "create_excalidraw_view") return null

  const fromResult = parseExcalidrawResult(result)
  if (fromResult) return fromResult

  return parseExcalidrawArgs(args)
}

function parseExcalidrawResult(result?: string): ExcalidrawView | null {
  if (!result) return null
  try {
    const parsed = JSON.parse(result) as Partial<ExcalidrawView>
    if (parsed.ok !== true || parsed.type !== "excalidraw_view" || !Array.isArray(parsed.elements)) {
      return null
    }
    return parsed as ExcalidrawView
  } catch {
    return null
  }
}

function parseExcalidrawArgs(args?: string): ExcalidrawView | null {
  if (!args) return null
  try {
    const parsed = JSON.parse(args) as { elements?: string; title?: string }
    if (typeof parsed.elements !== "string") return null
    const elements = JSON.parse(parsed.elements) as ExcalidrawElement[]
    if (!Array.isArray(elements)) return null
    return {
      ok: true,
      type: "excalidraw_view",
      title: parsed.title || "Streaming sketch",
      elements,
      source: "streaming-tool-input",
    }
  } catch {
    return parsePartialExcalidrawArgs(args)
  }
}

function parsePartialExcalidrawArgs(args: string): ExcalidrawView | null {
  const elementsText = extractJsonStringValuePrefix(args, "elements")
  if (!elementsText) return null

  const elements = extractCompleteArrayObjects(elementsText) as ExcalidrawElement[]
  if (elements.length === 0) return null

  return {
    ok: true,
    type: "excalidraw_view",
    title: extractJsonStringValuePrefix(args, "title") || "Streaming sketch",
    elements,
    element_count: elements.length,
    source: "partial-streaming-tool-input",
  }
}

function extractJsonStringValuePrefix(source: string, key: string): string | null {
  const keyIndex = source.indexOf(`"${key}"`)
  if (keyIndex < 0) return null

  const colonIndex = source.indexOf(":", keyIndex)
  if (colonIndex < 0) return null

  const quoteIndex = source.indexOf('"', colonIndex + 1)
  if (quoteIndex < 0) return null

  let raw = ""
  let escaped = false
  for (let index = quoteIndex + 1; index < source.length; index += 1) {
    const char = source[index]
    if (escaped) {
      raw += `\\${char}`
      escaped = false
      continue
    }
    if (char === "\\") {
      escaped = true
      continue
    }
    if (char === '"') break
    raw += char
  }

  return decodeJsonStringPrefix(raw)
}

function decodeJsonStringPrefix(raw: string): string {
  const candidates = [
    raw,
    raw.replace(/\\u[0-9a-fA-F]{0,3}$/, "").replace(/\\$/, ""),
    raw.replace(/\\[^"\\/bfnrtu]$/, ""),
  ]
  for (const candidate of candidates) {
    try {
      return JSON.parse(`"${candidate}"`) as string
    } catch {
      // Continue with a more forgiving fallback below.
    }
  }

  return raw
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\")
}

function extractCompleteArrayObjects(source: string): Record<string, unknown>[] {
  const arrayStart = source.indexOf("[")
  if (arrayStart < 0) return []

  const objects: Record<string, unknown>[] = []
  let inString = false
  let escaped = false
  let objectDepth = 0
  let objectStart = -1

  for (let index = arrayStart + 1; index < source.length; index += 1) {
    const char = source[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }
    if (char === "{") {
      if (objectDepth === 0) objectStart = index
      objectDepth += 1
      continue
    }
    if (char === "}") {
      objectDepth -= 1
      if (objectDepth === 0 && objectStart >= 0) {
        const rawObject = source.slice(objectStart, index + 1)
        try {
          const parsed = JSON.parse(rawObject) as Record<string, unknown>
          if (parsed && typeof parsed === "object") objects.push(parsed)
        } catch {
          // Ignore incomplete or malformed streamed objects.
        }
        objectStart = -1
      }
    }
  }

  return objects
}

export function ToolCallDisplay({ name, args, status, progress, result }: ToolRenderProps) {
  const [expanded, setExpanded] = useState(false)
  const diagram = parseDiagramResult(name, result)
  const excalidrawView = parseExcalidrawView(name, result, args)
  const showRawDetails = !excalidrawView
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
        <span className="text-gray-600">{name}</span>
        {status === "streaming" && (
          <Loader2 size={12} className="animate-spin text-blue-500 ml-auto" />
        )}
        {status === "executing" && (
          <Loader2 size={12} className="animate-spin text-amber-500 ml-auto" />
        )}
        {status === "complete" && <CheckCircle2 size={12} className="text-green-500 ml-auto" />}
      </button>

      {activity.length > 0 && status !== "complete" && (
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

      {excalidrawView && (
        <Suspense
          fallback={
            <figure className="my-2 overflow-hidden rounded border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-3 py-2 text-xs font-medium text-slate-600">
                {excalidrawView.title || "Excalidraw view"}
              </div>
              <div
                className="flex h-[420px] w-full items-center justify-center bg-white text-xs text-slate-500"
                role="img"
                aria-label={excalidrawView.title || "Excalidraw view"}
              >
                Loading Excalidraw...
              </div>
            </figure>
          }
        >
          <ExcalidrawSketch view={excalidrawView} />
        </Suspense>
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
          {showRawDetails && args && (
            <div>
              <div className="text-xs text-gray-400">Input</div>
              <pre className="text-xs text-gray-600 whitespace-pre-wrap break-words mt-0.5">
                {args}
              </pre>
            </div>
          )}
          {showRawDetails && result && (
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
