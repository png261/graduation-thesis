import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ChatInput, NO_REPOSITORY_VALUE } from "@/components/chat/ChatInput"

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
  it("renders an OpenAI-style rounded composer with icon controls", () => {
    render(
      <ChatInput
        input="Run terraform plan"
        setInput={vi.fn()}
        handleSubmit={vi.fn()}
        isLoading={false}
        repositories={repositories}
        selectedRepositoryFullName={NO_REPOSITORY_VALUE}
        onRepositoryChange={vi.fn()}
      />
    )

    expect(screen.getByRole("form", { name: "chat input" })).toHaveClass("rounded-[28px]")
    expect(screen.getByRole("form", { name: "chat input" })).toHaveAttribute("data-input-layout", "compact-inline")
    expect(screen.getByRole("textbox")).toHaveClass("border-0", "bg-transparent")
    expect(screen.getByRole("button", { name: "Add context" })).toHaveClass("rounded-full", "border-0")
    expect(screen.getByRole("button", { name: "Add context" })).not.toHaveClass("border-slate-200")
    expect(screen.queryByLabelText("Selected repository: No repository")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Selected state backend: No state backend")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Send message" })).toHaveClass("h-9", "w-9", "rounded-full")
    expect(screen.queryByText(/^Send$/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Add context" }))

    expect(screen.getByRole("button", { name: "Add file" })).toBeInTheDocument()
  })

  it("uses the requested message placeholder", () => {
    render(
      <ChatInput
        input=""
        setInput={vi.fn()}
        handleSubmit={vi.fn()}
        isLoading={false}
      />
    )

    expect(screen.getByPlaceholderText("Type your message...")).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/Ctrl\+Enter/)).not.toBeInTheDocument()
  })

  it("auto-grows the message input until the maximum height and stacks controls below it", async () => {
    const { rerender } = render(
      <ChatInput
        input="short"
        setInput={vi.fn()}
        handleSubmit={vi.fn()}
        isLoading={false}
      />
    )
    const textarea = screen.getByRole("textbox")
    Object.defineProperty(textarea, "scrollHeight", { value: 240, configurable: true })

    rerender(
      <ChatInput
        input={"long\n".repeat(20)}
        setInput={vi.fn()}
        handleSubmit={vi.fn()}
        isLoading={false}
      />
    )

    expect(textarea).toHaveStyle({ height: "200px", overflowY: "auto" })
    await waitFor(() => {
      expect(screen.getByRole("form", { name: "chat input" })).toHaveAttribute("data-input-layout", "stacked")
    })
    expect(screen.getByRole("textbox")).toHaveStyle({ height: "200px" })
  })

  it("keeps the message input editable while a response is running", () => {
    const setInput = vi.fn()
    render(
      <ChatInput
        input="Draft next prompt"
        setInput={setInput}
        handleSubmit={vi.fn()}
        isLoading
      />
    )

    const textarea = screen.getByRole("textbox")
    expect(textarea).not.toBeDisabled()
    fireEvent.change(textarea, { target: { value: "Draft next prompt while running" } })
    expect(setInput).toHaveBeenCalledWith("Draft next prompt while running")
  })

  it("renders a GitHub repository selector and reports changes", () => {
    const onRepositoryChange = vi.fn()
    render(
      <ChatInput
        input=""
        setInput={vi.fn()}
        handleSubmit={vi.fn()}
        isLoading={false}
        repositories={repositories}
        selectedRepositoryFullName={NO_REPOSITORY_VALUE}
        onRepositoryChange={onRepositoryChange}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Add context" }))
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
        repositories={repositories}
        selectedRepositoryFullName="png261/hcp-terraform"
        onRepositoryChange={vi.fn()}
        repositoryLocked
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Add context" }))
    expect(screen.getByRole("combobox", { name: "GitHub repository" })).toBeDisabled()
    expect(screen.queryByText("Repository locked")).not.toBeInTheDocument()
  })

  it("expands the composer with selected repository and state chips", () => {
    render(
      <ChatInput
        input=""
        setInput={vi.fn()}
        handleSubmit={vi.fn()}
        isLoading={false}
        repositories={repositories}
        selectedRepositoryFullName="png261/hcp-terraform"
        onRepositoryChange={vi.fn()}
        stateBackends={[
          {
            backendId: "backend-prod",
            name: "prod-state",
            bucket: "tf-prod-state",
            key: "env/prod/terraform.tfstate",
            region: "us-east-1",
            service: "s3",
            repository: repositories[0],
            createdAt: "2026-05-11T04:00:00.000Z",
            updatedAt: "2026-05-11T04:00:00.000Z",
          },
        ]}
        selectedStateBackendId="backend-prod"
        onStateBackendChange={vi.fn()}
      />
    )

    expect(screen.getByLabelText("Selected repository: png261/hcp-terraform")).toHaveTextContent("png261/hcp-terraform")
    expect(screen.getByLabelText("Selected state backend: prod-state")).toHaveTextContent("prod-state")
    expect(screen.getByRole("form", { name: "chat input" })).toHaveAttribute("data-input-layout", "stacked")
    expect(screen.queryByRole("combobox", { name: "GitHub repository" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Add context" }))

    expect(screen.getByRole("combobox", { name: "GitHub repository" })).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Terraform state backend" })).toBeInTheDocument()
  })

  it("uses destructive red styling for the stop button while loading", () => {
    const { container } = render(
      <ChatInput
        input="Run terraform plan"
        setInput={vi.fn()}
        handleSubmit={vi.fn()}
        isLoading
        onStop={vi.fn()}
      />
    )

    expect(screen.getByRole("button", { name: /stop/i })).toHaveClass("bg-red-600")
    expect(container.querySelector("[style*='--border-width']")).not.toBeNull()
  })

  it("renders attached images as previews without filenames", () => {
    const { container } = render(
      <ChatInput
        input=""
        setInput={vi.fn()}
        handleSubmit={vi.fn()}
        isLoading={false}
        attachments={[
          {
            id: "image-1",
            name: "diagram.png",
            type: "image/png",
            size: 128,
            dataUrl: "data:image/png;base64,iVBORw0KGgo=",
          },
        ]}
        onAttachmentsChange={vi.fn()}
      />
    )

    expect(screen.getByAltText("diagram.png")).toHaveAttribute("src", "data:image/png;base64,iVBORw0KGgo=")
    expect(screen.queryByText("diagram.png")).not.toBeInTheDocument()
    expect(container.querySelector("img")?.parentElement).toHaveClass("h-20", "w-20", "border")
  })

  it("keeps non-image attachment filenames visible", () => {
    render(
      <ChatInput
        input=""
        setInput={vi.fn()}
        handleSubmit={vi.fn()}
        isLoading={false}
        attachments={[
          {
            id: "file-1",
            name: "main.tf",
            type: "text/plain",
            size: 128,
            dataUrl: "data:text/plain;base64,dmFyaWFibGU=",
          },
        ]}
        onAttachmentsChange={vi.fn()}
      />
    )

    expect(screen.getByText("main.tf")).toHaveClass("bg-slate-100")
  })
})
