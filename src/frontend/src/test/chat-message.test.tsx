import { act, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ChatMessage, THINKING_WORDS } from "@/components/chat/ChatMessage"

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

    expect(screen.getByText("Run terraform plan").parentElement?.parentElement).toHaveClass(
      "rounded-[1.35rem]",
      "bg-[#f4f4f4]",
      "text-slate-950"
    )
  })

  it("rotates random animated thinking words over time", () => {
    vi.useFakeTimers()
    const randomSpy = vi.spyOn(Math, "random")
    randomSpy.mockReturnValueOnce(0)
    randomSpy.mockReturnValueOnce(0.999999)

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
    expect(screen.getByText(THINKING_WORDS[0].toUpperCase())).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(1400)
    })
    expect(screen.getByText(THINKING_WORDS[THINKING_WORDS.length - 1].toUpperCase())).toBeInTheDocument()
    expect(screen.queryByText("MACOG Agent is working")).not.toBeInTheDocument()
    expect(screen.queryByText("Preparing a response")).not.toBeInTheDocument()
  })

})
