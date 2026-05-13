import type { MessageSegment, ToolCall } from "./types"

export type ToolUseStartEvent = {
  toolUseId: string
  name: string
}

export function ensureToolCallSegment(
  segments: MessageSegment[],
  toolCallMap: Map<string, ToolCall>,
  event: ToolUseStartEvent
): ToolCall {
  const existing = toolCallMap.get(event.toolUseId)
  if (existing) {
    existing.name = event.name || existing.name
    const hasSegment = segments.some(
      segment => segment.type === "tool" && segment.toolCall.toolUseId === event.toolUseId
    )
    if (!hasSegment) {
      segments.push({ type: "tool", toolCall: existing })
    }
    return existing
  }

  const toolCall: ToolCall = {
    toolUseId: event.toolUseId,
    name: event.name,
    input: "",
    status: "streaming",
  }
  toolCallMap.set(event.toolUseId, toolCall)
  segments.push({ type: "tool", toolCall })
  return toolCall
}
