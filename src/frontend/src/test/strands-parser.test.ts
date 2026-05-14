import { describe, expect, it } from "vitest"
import { parseStrandsChunk } from "@/lib/agentcore-client/parsers/strands"
import type { StreamEvent } from "@/lib/agentcore-client"

describe("parseStrandsChunk", () => {
  it("starts a tool call and emits input snapshots from current_tool_use events", () => {
    const events: StreamEvent[] = []
    parseStrandsChunk(
      `data: ${JSON.stringify({
        current_tool_use: {
          toolUseId: "tool-1",
          name: "create_excalidraw_view",
          input: {
            title: "Streaming sketch",
            elements: '[{"type":"rectangle","id":"box","x":10,"y":10,"width":100,"height":60}]',
          },
        },
      })}`,
      event => events.push(event)
    )

    expect(events).toEqual([
      {
        type: "tool_use_start",
        toolUseId: "tool-1",
        name: "create_excalidraw_view",
      },
      {
        type: "tool_use_input_snapshot",
        toolUseId: "tool-1",
        input:
          '{"title":"Streaming sketch","elements":"[{\\"type\\":\\"rectangle\\",\\"id\\":\\"box\\",\\"x\\":10,\\"y\\":10,\\"width\\":100,\\"height\\":60}]"}',
      },
    ])
  })

  it("emits specialist tool progress from tool stream events", () => {
    const events: StreamEvent[] = []
    parseStrandsChunk(
      `data: ${JSON.stringify({
        type: "tool_stream",
        tool_stream_event: {
          tool_use: {
            toolUseId: "tool-2",
            name: "architect_agent",
          },
          data: {
            specialistToolProgress: {
              phase: "text",
              message: "architect_agent is drafting a VPC design",
            },
          },
        },
      })}`,
      event => events.push(event)
    )

    expect(events).toEqual([
      {
        type: "tool_progress",
        toolUseId: "tool-2",
        phase: "text",
        message: "architect_agent is drafting a VPC design",
      },
    ])
  })
})
