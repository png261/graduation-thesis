import type { ReactNode } from "react"
import type { ChatAgent, ToolCallStatus, ToolProgressEntry } from "@/components/chat/types"

export interface ToolRenderProps {
  name: string
  args: string
  status: ToolCallStatus
  progress?: ToolProgressEntry[]
  result?: string
  agent?: ChatAgent
}

export type ToolRenderFn = (props: ToolRenderProps) => ReactNode

const renderers = new Map<string, ToolRenderFn>()

export function useDefaultTool(render: ToolRenderFn) {
  renderers.set("*", render)
}

export function useToolRenderer(name: string, render: ToolRenderFn) {
  renderers.set(name, render)
}

export function getToolRenderer(name: string): ToolRenderFn | null {
  return renderers.get(name) ?? renderers.get("*") ?? null
}
