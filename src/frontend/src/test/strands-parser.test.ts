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
          name: "diagram",
          input: {
            diagram_type: "graph",
            nodes: [{ id: "vpc", label: "VPC" }],
          },
        },
      })}`,
      event => events.push(event)
    )

    expect(events).toEqual([
      {
        type: "tool_use_start",
        toolUseId: "tool-1",
        name: "diagram",
      },
      {
        type: "tool_use_input_snapshot",
        toolUseId: "tool-1",
        input: '{"diagram_type":"graph","nodes":[{"id":"vpc","label":"VPC"}]}',
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

  it("throws runtime status errors so the chat can show an error state", () => {
    expect(() =>
      parseStrandsChunk(
        `data: ${JSON.stringify({
          status: "error",
          error: "Error code: 402 - INSUFFICIENT_BALANCE",
        })}`,
        () => undefined
      )
    ).toThrow("Error code: 402 - INSUFFICIENT_BALANCE")
  })

  it("emits checkpoint lifecycle events", () => {
    const events: StreamEvent[] = []
    parseStrandsChunk(
      `data: ${JSON.stringify({
        lifecycle: "checkpoint_saved",
      })}`,
      event => events.push(event)
    )

    expect(events).toEqual([{ type: "lifecycle", event: "checkpoint_saved" }])
  })
})
