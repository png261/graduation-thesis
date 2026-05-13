import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { ChatMessage } from "@/components/chat/ChatMessage"

vi.mock("@/components/chat/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}))

describe("ChatMessage", () => {
  it("renders a minimal animated thinking state", () => {
    render(
      <ChatMessage
        message={{
          role: "assistant",
          content: "Thinking...",
          timestamp: "2026-05-11T03:00:00.000Z",
          agent: {
            id: "agent2",
            mention: "@macog",
            name: "MACOG Agent",
            avatar: "MO",
            className: "bg-sky-600 text-white",
          },
        }}
        sessionId="session-1"
        onFeedbackSubmit={async () => undefined}
      />
    )

    expect(screen.getByRole("status", { name: "thinking" })).toBeInTheDocument()
    expect(screen.getByText("thinking")).toBeInTheDocument()
    expect(screen.queryByText("MACOG Agent is working")).not.toBeInTheDocument()
    expect(screen.queryByText("Preparing a response")).not.toBeInTheDocument()
  })
})
