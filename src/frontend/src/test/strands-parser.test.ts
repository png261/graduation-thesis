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
})
