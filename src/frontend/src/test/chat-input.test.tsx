import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ChatInput, NO_REPOSITORY_VALUE } from "@/components/chat/ChatInput"
import { CHAT_AGENTS } from "@/components/chat/agents"

const repositories = [
  {
    owner: "png261",
    name: "hcp-terraform",
    fullName: "png261/hcp-terraform",
    defaultBranch: "main",
  },
  {
    owner: "png261",
    name: "agent-demo",
    fullName: "png261/agent-demo",
    defaultBranch: "main",
  },
]

describe("ChatInput", () => {
  it("starts agent selection with @ and inserts an agent mention", () => {
    const setInput = vi.fn()
    const { rerender } = render(
      <ChatInput
        input=""
        setInput={setInput}
        handleSubmit={vi.fn()}
        isLoading={false}
        agents={CHAT_AGENTS}
      />
    )

    fireEvent.mouseDown(screen.getByRole("button", { name: "Mention agent" }))
    expect(setInput).toHaveBeenCalledWith("@")

    rerender(
      <ChatInput
        input="@"
        setInput={setInput}
        handleSubmit={vi.fn()}
        isLoading={false}
        agents={CHAT_AGENTS}
      />
    )

    fireEvent.mouseDown(screen.getByRole("button", { name: /DevOps Agent/i }))
    expect(setInput).toHaveBeenLastCalledWith("@devops ")
  })

  it("renders a GitHub repository selector and reports changes", () => {
    const onRepositoryChange = vi.fn()
    render(
      <ChatInput
        input=""
        setInput={vi.fn()}
        handleSubmit={vi.fn()}
        isLoading={false}
        agents={CHAT_AGENTS}
        repositories={repositories}
        selectedRepositoryFullName={NO_REPOSITORY_VALUE}
        onRepositoryChange={onRepositoryChange}
      />
    )

    fireEvent.click(screen.getByRole("combobox", { name: "GitHub repository" }))
    fireEvent.click(screen.getByRole("option", { name: "png261/hcp-terraform" }))

    expect(onRepositoryChange).toHaveBeenCalledWith("png261/hcp-terraform")
  })

  it("disables the repository selector after it is locked", () => {
    render(
      <ChatInput
        input=""
        setInput={vi.fn()}
        handleSubmit={vi.fn()}
        isLoading={false}
        agents={CHAT_AGENTS}
        repositories={repositories}
        selectedRepositoryFullName="png261/hcp-terraform"
        onRepositoryChange={vi.fn()}
        repositoryLocked
      />
    )

    expect(screen.getByRole("combobox", { name: "GitHub repository" })).toBeDisabled()
    expect(screen.getByText("Repository locked")).toBeInTheDocument()
  })
})
