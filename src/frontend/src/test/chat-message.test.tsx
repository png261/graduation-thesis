import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ChatMessage } from "@/components/chat/ChatMessage"

vi.mock("@/components/chat/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}))

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("ChatMessage", () => {
  it("renders user messages as light rounded ChatGPT-style bubbles", () => {
    render(
      <ChatMessage
        message={{
          role: "user",
          content: "Run terraform plan",
          timestamp: "2026-05-11T03:00:00.000Z",
        }}
      />
    )

    expect(screen.getByText("Run terraform plan")).toHaveClass(
      "rounded-[1.35rem]",
      "bg-[#f4f4f4]",
      "whitespace-pre-wrap"
    )
  })

  it("renders user images without filenames and keeps prompt text in a gray bubble underneath", () => {
    const { container } = render(
      <ChatMessage
        message={{
          role: "user",
          content: "Please review this diagram.",
          timestamp: "2026-05-11T03:00:00.000Z",
          attachments: [
            {
              id: "attachment-1",
              name: "network-diagram.png",
              type: "image/png",
              size: 128,
              dataUrl: "data:image/png;base64,iVBORw0KGgo=",
            },
          ],
        }}
      />
    )

    expect(screen.getByAltText("network-diagram.png")).toHaveAttribute("src", "data:image/png;base64,iVBORw0KGgo=")
    expect(screen.queryByText("network-diagram.png")).not.toBeInTheDocument()
    expect(screen.getByText("Please review this diagram.")).toHaveClass("bg-[#f4f4f4]")
    const renderedText = container.textContent ?? ""
    expect(renderedText).toBe("Please review this diagram.")
  })

  it("does not crash when an old image attachment has metadata but no persisted preview payload", () => {
    render(
      <ChatMessage
        message={{
          role: "user",
          content: "Give me terraform code for this architecture [Image #1]",
          timestamp: "2026-05-11T03:00:00.000Z",
          attachments: [
            {
              id: "attachment-1",
              name: "architecture.png",
              type: "image/png",
              size: 640000,
            },
          ],
        }}
      />
    )

    expect(screen.getByText("Image preview unavailable")).toBeInTheDocument()
    expect(screen.getByText("Give me terraform code for this architecture [Image #1]")).toBeInTheDocument()
  })

  it("shows a clear animated response loading state", () => {
    render(
      <ChatMessage
        message={{
          role: "assistant",
          content: "Thinking...",
          timestamp: "2026-05-11T03:00:00.000Z",
          agent: {
            id: "agent1",
            name: "InfraQ Orchestrator",
            avatar: "IQ",
            className: "bg-sky-600 text-white",
          },
        }}
      />
    )

    expect(screen.getByRole("status", { name: "thinking" })).toBeInTheDocument()
    expect(screen.getByText("Agent is responding")).toBeInTheDocument()
    expect(screen.queryByText("MACOG Agent is working")).not.toBeInTheDocument()
    expect(screen.queryByText("Preparing a response")).not.toBeInTheDocument()
  })

})
