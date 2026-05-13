import { describe, expect, it } from "vitest"
import { ensureToolCallSegment } from "@/components/chat/tool-call-state"
import type { MessageSegment, ToolCall } from "@/components/chat/types"

describe("tool call state", () => {
  it("deduplicates repeated tool_use_start events for the same toolUseId", () => {
    const segments: MessageSegment[] = []
    const toolCallMap = new Map<string, ToolCall>()
    const event = { toolUseId: "tool-1", name: "render_architecture_diagram" }

    const first = ensureToolCallSegment(segments, toolCallMap, event)
    const second = ensureToolCallSegment(segments, toolCallMap, event)

    expect(second).toBe(first)
    expect(toolCallMap.size).toBe(1)
    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({
      type: "tool",
      toolCall: {
        toolUseId: "tool-1",
        name: "render_architecture_diagram",
      },
    })
  })

  it("reuses an existing mapped tool call if its segment is missing", () => {
    const segments: MessageSegment[] = []
    const toolCallMap = new Map<string, ToolCall>()
    const toolCall: ToolCall = {
      toolUseId: "tool-1",
      name: "file_read",
      input: "",
      status: "streaming",
    }
    toolCallMap.set(toolCall.toolUseId, toolCall)

    const result = ensureToolCallSegment(segments, toolCallMap, {
      toolUseId: "tool-1",
      name: "file_read",
    })

    expect(result).toBe(toolCall)
    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({ type: "tool", toolCall })
  })
})
