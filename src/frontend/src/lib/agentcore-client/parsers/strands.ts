import type { ChunkParser } from "../types"

/**
 * Parses SSE chunks from Strands agents.
 * Emits typed StreamEvents for text, tool use, messages, and lifecycle.
 */
export const parseStrandsChunk: ChunkParser = (line, callback) => {
  if (!line.startsWith("data: ")) return

  const data = line.substring(6).trim()
  if (!data) return

  try {
    const json = JSON.parse(data)

    if (json.status === "error") {
      throw new Error(typeof json.error === "string" && json.error ? json.error : "Agent runtime returned an error")
    }

    if (json.pullRequest) {
      callback({ type: "pull_request", pullRequest: json.pullRequest })
      return
    }

    if (isUserHandoffPayload(json.userHandoff)) {
      callback({ type: "user_handoff", handoff: json.userHandoff })
      return
    }

    if (isChatAgentPayload(json.chatAgent)) {
      callback({ type: "agent", agent: json.chatAgent })
      return
    }

    if (isChatAgentPayload(json.agent)) {
      callback({ type: "agent", agent: json.agent })
      return
    }

    if (typeof json.sessionTitle === "string") {
      callback({ type: "session_title", title: json.sessionTitle })
      return
    }

    if (json.type === "tool_stream") {
      const toolUseId = json.tool_stream_event?.tool_use?.toolUseId
      const progress = json.tool_stream_event?.data?.specialistToolProgress
      if (
        typeof toolUseId === "string" &&
        progress &&
        typeof progress === "object" &&
        typeof progress.phase === "string" &&
        typeof progress.message === "string"
      ) {
        callback({
          type: "tool_progress",
          toolUseId,
          phase: progress.phase,
          message: progress.message,
        })
      }
      return
    }

    // Text streaming
    if (typeof json.data === "string") {
      callback({ type: "text", content: json.data })
      return
    }

    // Tool use streaming. Strands may send either Bedrock-style input deltas
    // or a complete/current tool input snapshot on current_tool_use.
    if (json.current_tool_use) {
      const tool = json.current_tool_use
      callback({
        type: "tool_use_start",
        toolUseId: tool.toolUseId,
        name: tool.name,
      })

      if (typeof json.delta?.toolUse?.input === "string" && json.delta.toolUse.input !== "") {
        callback({
          type: "tool_use_delta",
          toolUseId: tool.toolUseId,
          input: json.delta.toolUse.input,
        })
      } else if (tool.input !== undefined && tool.input !== null) {
        callback({
          type: "tool_use_input_snapshot",
          toolUseId: tool.toolUseId,
          input: typeof tool.input === "string" ? tool.input : JSON.stringify(tool.input),
        })
      }
      return
    }

    // Complete message (assistant with toolUse, or user with toolResult)
    if (json.message) {
      const msg = json.message
      callback({ type: "message", role: msg.role, content: msg.content })

      // Extract tool results from user messages
      if (msg.role === "user" && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.toolResult) {
            const resultText =
              block.toolResult.content
                ?.map((c: { text?: string }) => c.text)
                .filter(Boolean)
                .join("") || JSON.stringify(block.toolResult.content)
            callback({
              type: "tool_result",
              toolUseId: block.toolResult.toolUseId,
              result: resultText,
            })
          }
        }
      }
      return
    }

    // Final result
    if (json.result) {
      callback({
        type: "result",
        stopReason: typeof json.result === "object" ? json.result.stop_reason : "end_turn",
      })
      return
    }

    // Lifecycle events
    if (json.init_event_loop || json.start_event_loop || json.start) {
      const event = json.init_event_loop ? "init" : json.start_event_loop ? "start_loop" : "start"
      callback({ type: "lifecycle", event })
      return
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    console.debug("Failed to parse strands event:", data)
  }
}

function isUserHandoffPayload(value: unknown): value is {
  type: "user_handoff"
  questions: Array<{ id: string; question: string; options: string[] }>
} {
  if (!value || typeof value !== "object") return false
  const handoff = value as Record<string, unknown>
  if (handoff.type !== "user_handoff" || !Array.isArray(handoff.questions)) return false
  return handoff.questions.every(question => {
    if (!question || typeof question !== "object") return false
    const item = question as Record<string, unknown>
    return (
      typeof item.id === "string" &&
      typeof item.question === "string" &&
      Array.isArray(item.options) &&
      item.options.length === 3 &&
      item.options.every(option => typeof option === "string")
    )
  })
}

function isChatAgentPayload(value: unknown): value is {
  id: "agent1"
  mention: "@orchestrator"
  name: string
  avatar: string
  className: string
} {
  if (!value || typeof value !== "object") return false
  const agent = value as Record<string, unknown>
  return (
    agent.id === "agent1" &&
    agent.mention === "@orchestrator" &&
    typeof agent.name === "string" &&
    typeof agent.avatar === "string" &&
    typeof agent.className === "string"
  )
}
