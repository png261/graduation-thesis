import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import ChatInterface from "@/components/chat/ChatInterface"
import { hasRunningSessionController, reconcileRunningSessions } from "@/components/chat/running-sessions"

const store = vi.hoisted(() => {
  let state: Record<string, any> = {}
  const actions = {
    hydrateChatSessions: vi.fn(async () => ({
      sessions: state.sessions ?? [],
      activeSessionId: state.activeSessionId ?? "",
    })),
    persistChatSessions: vi.fn(async () => ({
      sessions: state.sessions ?? [],
      activeSessionId: state.activeSessionId ?? "",
    })),
    setSessions: vi.fn((sessions: unknown[]) => {
      state.sessions = sessions
    }),
    setActiveSessionId: vi.fn((activeSessionId: string) => {
      state.activeSessionId = activeSessionId
    }),
  }
  const current = () => ({ ...state, ...actions })
  const useWebAppStore = ((selector: (value: Record<string, any>) => unknown) => selector(current())) as any
  useWebAppStore.getState = current
  useWebAppStore.setState = (next: Record<string, any>) => {
    state = { ...state, ...next }
  }
  return { useWebAppStore }
})

const agentCoreClientMock = vi.hoisted(() => ({
  githubAction: vi.fn(async (action: string) =>
    action === "listInstalledRepositories"
      ? {
          repositories: [
            {
              owner: "png261",
              name: "hcp-terraform",
              fullName: "png261/hcp-terraform",
              defaultBranch: "main",
            },
          ],
        }
      : { status: "ok", workspace: { path: "/mnt/s3/sessions/session-no-repo/repos/png261/hcp-terraform" } }
  ),
  invoke: vi.fn(),
}))

vi.mock("@/stores/webAppStore", () => ({
  useWebAppStore: store.useWebAppStore,
}))

vi.mock("@/app/context/GlobalContext", () => ({
  useGlobal: () => ({ isLoading: false, setIsLoading: vi.fn() }),
}))

vi.mock("react-oidc-context", () => ({
  useAuth: () => ({
    user: {
      access_token: "access-token",
      id_token: "id-token",
    },
  }),
}))

vi.mock("@/hooks/useToolRenderer", () => ({
  useDefaultTool: vi.fn(),
}))

vi.mock("@/lib/agentcore-client", () => ({
  AgentCoreClient: vi.fn().mockImplementation(function AgentCoreClient() {
    return {
      githubAction: agentCoreClientMock.githubAction,
      invoke: agentCoreClientMock.invoke,
    }
  }),
}))

vi.mock("@/services/resourcesService", () => ({
  listStateBackends: vi.fn(async () => [
    {
      backendId: "backend-prod",
      name: "prod-state",
      bucket: "tf-prod-state",
      key: "env/prod/terraform.tfstate",
      region: "us-east-1",
      service: "s3",
      repository: {
        owner: "png261",
        name: "hcp-terraform",
        fullName: "png261/hcp-terraform",
        defaultBranch: "main",
      },
      createdAt: "2026-05-11T04:00:00.000Z",
      updatedAt: "2026-05-11T04:00:00.000Z",
    },
  ]),
}))

vi.mock("@/components/files/FileSystemPanel", () => ({
  FileSystemPanel: () => <div data-testid="filesystem-panel" />,
}))

vi.mock("@/components/ui/cursor-driven-particle-typography", () => ({
  CursorDrivenParticleTypography: ({ text }: { text: string }) => <div>{text}</div>,
}))

vi.mock("@/components/chat/ChatInput", () => ({
  ChatInput: ({
    input,
    setInput,
    handleSubmit,
    isLoading,
    onStop,
    repositoryLocked,
    selectedRepositoryFullName,
    onRepositoryChange,
    selectedStateBackendId,
    onStateBackendChange,
  }: {
    input?: string
    setInput?: (value: string) => void
    handleSubmit?: (event: { preventDefault: () => void }) => void
    isLoading?: boolean
    onStop?: () => void
    repositoryLocked?: boolean
    selectedRepositoryFullName?: string
    onRepositoryChange?: (value: string) => void
    selectedStateBackendId?: string
    onStateBackendChange?: (value: string) => void
  }) => (
    <form
      aria-label="chat input"
      data-repository-locked={String(Boolean(repositoryLocked))}
      data-is-loading={String(Boolean(isLoading))}
      data-input={input}
      data-selected-repository={selectedRepositoryFullName}
      data-selected-state-backend={selectedStateBackendId}
    >
      <button
        type="button"
        onClick={() => onRepositoryChange?.("png261/hcp-terraform")}
      >
        Choose hcp-terraform
      </button>
      <button
        type="button"
        onClick={() => onStateBackendChange?.("backend-prod")}
      >
        Choose prod state
      </button>
      <button type="button" onClick={() => setInput?.("Run terraform plan")}>
        Type plan prompt
      </button>
      <button type="button" onClick={() => handleSubmit?.({ preventDefault: vi.fn() })}>
        Send prompt
      </button>
      <button type="button" onClick={() => onStop?.()}>
        Stop prompt
      </button>
    </form>
  ),
}))

describe("ChatInterface new repository chat", () => {
  beforeEach(() => {
    agentCoreClientMock.githubAction.mockClear()
    agentCoreClientMock.invoke.mockClear()
    reconcileRunningSessions([])
    Element.prototype.scrollIntoView = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      setTransform: vi.fn(),
      scale: vi.fn(),
      clearRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 320 })),
      getImageData: vi.fn(() => ({ width: 0, height: 0, data: new Uint8ClampedArray() })),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          agentRuntimeArn: "arn:aws:bedrock-agentcore:ap-southeast-1:123456789012:runtime/test",
          awsRegion: "ap-southeast-1",
        }),
      })
    )
    store.useWebAppStore.setState({
      sessions: [
        {
          id: "session-1",
          name: "New chat",
          history: [],
          startDate: "2026-05-11T04:00:00.000Z",
          endDate: "2026-05-11T04:00:00.000Z",
          repository: {
            owner: "png261",
            name: "hcp-terraform",
            fullName: "png261/hcp-terraform",
            defaultBranch: "main",
          },
        },
      ],
      activeSessionId: "session-1",
      newChatRequestId: 0,
      repositoryChatRequest: null,
    })
  })

  it("shows visible starter content after a repository chat is created", async () => {
    render(<ChatInterface />)

    expect(screen.getByText("InfraQ")).toBeInTheDocument()
    expect(screen.queryByText("Ask me anything to get started")).not.toBeInTheDocument()
    expect(screen.getByRole("form", { name: "chat input" })).toBeInTheDocument()
    expect(screen.queryByText("Connect a GitHub Repository")).not.toBeInTheDocument()
    expect(screen.queryByTestId("filesystem-panel")).not.toBeInTheDocument()
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
  })

  it("allows a new chat without a connected repository", async () => {
    store.useWebAppStore.setState({
      sessions: [
        {
          id: "session-no-repo",
          name: "New chat",
          history: [],
          startDate: "2026-05-11T04:00:00.000Z",
          endDate: "2026-05-11T04:00:00.000Z",
          repository: null,
        },
      ],
      activeSessionId: "session-no-repo",
      newChatRequestId: 0,
      repositoryChatRequest: null,
      chatSessionsLoadedFor: "id-token",
    })

    expect(hasRunningSessionController("session-reloaded-pending")).toBe(false)
    render(<ChatInterface />)

    expect(screen.getByText("InfraQ")).toBeInTheDocument()
    expect(screen.queryByText("Ask me anything to get started")).not.toBeInTheDocument()
    expect(screen.getByRole("form", { name: "chat input" })).toBeInTheDocument()
    expect(screen.queryByText(/No repository connected/i)).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Connect Repository" })).not.toBeInTheDocument()
    expect(screen.queryByTestId("filesystem-panel")).not.toBeInTheDocument()
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
  })

  it("locks repository selection once the chat has been sent to the agent", async () => {
    store.useWebAppStore.setState({
      sessions: [
        {
          id: "session-locked",
          name: "Locked chat",
          history: [
            {
              role: "user",
              content: "Plan the infra",
              timestamp: "2026-05-11T04:01:00.000Z",
            },
          ],
          startDate: "2026-05-11T04:00:00.000Z",
          endDate: "2026-05-11T04:01:00.000Z",
          repository: {
            owner: "png261",
            name: "hcp-terraform",
            fullName: "png261/hcp-terraform",
            defaultBranch: "main",
          },
        },
      ],
      activeSessionId: "session-locked",
      newChatRequestId: 0,
      repositoryChatRequest: null,
      chatSessionsLoadedFor: "id-token",
    })

    render(<ChatInterface />)

    await waitFor(() =>
      expect(screen.getByRole("form", { name: "chat input" })).toHaveAttribute("data-repository-locked", "true")
    )
    expect(screen.getByRole("form", { name: "chat input" })).toHaveAttribute(
      "data-selected-repository",
      "png261/hcp-terraform"
    )
  })

  it("keeps repository selection unlocked after sending without a repository", async () => {
    store.useWebAppStore.setState({
      sessions: [
        {
          id: "session-no-repo-history",
          name: "Repo-less chat",
          history: [
            {
              role: "user",
              content: "Answer generally",
              timestamp: "2026-05-11T04:01:00.000Z",
            },
          ],
          startDate: "2026-05-11T04:00:00.000Z",
          endDate: "2026-05-11T04:01:00.000Z",
          repository: null,
        },
      ],
      activeSessionId: "session-no-repo-history",
      newChatRequestId: 0,
      repositoryChatRequest: null,
      chatSessionsLoadedFor: "id-token",
    })

    render(<ChatInterface />)

    await waitFor(() =>
      expect(screen.getByRole("form", { name: "chat input" })).toHaveAttribute("data-repository-locked", "false")
    )
    expect(screen.queryByRole("button", { name: "Connect Repository" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Choose hcp-terraform" })).toBeEnabled()
  })

  it("does not auto-scroll messages and shows a latest response button when scrolled up", async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    store.useWebAppStore.setState({
      sessions: [
        {
          id: "session-with-history",
          name: "History chat",
          history: [
            {
              role: "user",
              content: "Initial question",
              timestamp: "2026-05-11T04:00:00.000Z",
            },
            {
              role: "assistant",
              content: "Long response",
              timestamp: "2026-05-11T04:01:00.000Z",
            },
          ],
          startDate: "2026-05-11T04:00:00.000Z",
          endDate: "2026-05-11T04:01:00.000Z",
          repository: null,
        },
      ],
      activeSessionId: "session-with-history",
      newChatRequestId: 0,
      repositoryChatRequest: null,
      chatSessionsLoadedFor: "id-token",
    })

    render(<ChatInterface />)

    expect(screen.getByText("Long response")).toBeInTheDocument()
    expect(scrollIntoView).not.toHaveBeenCalled()

    const messageContainer = screen.getByTestId("chat-messages")
    Object.defineProperty(messageContainer, "scrollHeight", { configurable: true, value: 1200 })
    Object.defineProperty(messageContainer, "clientHeight", { configurable: true, value: 400 })
    Object.defineProperty(messageContainer, "scrollTop", { configurable: true, value: 200 })
    fireEvent.scroll(messageContainer)

    const latestButton = await screen.findByRole("button", { name: "Scroll to latest response" })
    fireEvent.click(latestButton)

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth" })
  })

  it("clones the chosen repository into the current session workspace", async () => {
    store.useWebAppStore.setState({
      sessions: [
        {
          id: "session-no-repo",
          name: "New chat",
          history: [],
          startDate: "2026-05-11T04:00:00.000Z",
          endDate: "2026-05-11T04:00:00.000Z",
          repository: null,
        },
      ],
      activeSessionId: "session-no-repo",
      newChatRequestId: 0,
      repositoryChatRequest: null,
      chatSessionsLoadedFor: "id-token",
    })

    render(<ChatInterface />)

    await waitFor(() =>
      expect(agentCoreClientMock.githubAction).toHaveBeenCalledWith(
        "listInstalledRepositories",
        expect.any(String),
        "access-token",
        null
      )
    )

    fireEvent.click(screen.getByRole("button", { name: "Choose hcp-terraform" }))

    await waitFor(() =>
      expect(agentCoreClientMock.githubAction).toHaveBeenCalledWith(
        "setupRepositoryWorkspace",
        "session-no-repo",
        "access-token",
        {
          owner: "png261",
          name: "hcp-terraform",
          fullName: "png261/hcp-terraform",
          defaultBranch: "main",
        }
      )
    )
    await waitFor(() =>
      expect(screen.getByRole("form", { name: "chat input" })).toHaveAttribute(
        "data-selected-repository",
        "png261/hcp-terraform"
      )
    )
  })

  it("adds a selected Resource Catalog state backend to the current chat", async () => {
    store.useWebAppStore.setState({
      sessions: [
        {
          id: "session-state",
          name: "New chat",
          history: [],
          startDate: "2026-05-11T04:00:00.000Z",
          endDate: "2026-05-11T04:00:00.000Z",
          repository: null,
          stateBackend: null,
        },
      ],
      activeSessionId: "session-state",
      newChatRequestId: 0,
      repositoryChatRequest: null,
      chatSessionsLoadedFor: "id-token",
    })

    render(<ChatInterface />)

    await waitFor(() =>
      expect(screen.getByRole("form", { name: "chat input" })).toHaveAttribute(
        "data-selected-state-backend",
        "__no_state_backend__"
      )
    )

    fireEvent.click(screen.getByRole("button", { name: "Choose prod state" }))

    await waitFor(() =>
      expect(screen.getByRole("form", { name: "chat input" })).toHaveAttribute(
        "data-selected-state-backend",
        "backend-prod"
      )
    )
    expect(screen.getByRole("form", { name: "chat input" })).toHaveAttribute(
      "data-repository-locked",
      "true"
    )
    await waitFor(() =>
      expect(agentCoreClientMock.githubAction).toHaveBeenCalledWith(
        "setupRepositoryWorkspace",
        "session-state",
        "access-token",
        {
          owner: "png261",
          name: "hcp-terraform",
          fullName: "png261/hcp-terraform",
          defaultBranch: "main",
        }
      )
    )
  })

  it("sends the selected state backend to the agent runtime", async () => {
    agentCoreClientMock.invoke.mockResolvedValue(undefined)
    store.useWebAppStore.setState({
      sessions: [
        {
          id: "session-state-send",
          name: "New chat",
          history: [],
          startDate: "2026-05-11T04:00:00.000Z",
          endDate: "2026-05-11T04:00:00.000Z",
          repository: {
            owner: "png261",
            name: "hcp-terraform",
            fullName: "png261/hcp-terraform",
            defaultBranch: "main",
          },
          stateBackend: null,
        },
      ],
      activeSessionId: "session-state-send",
      newChatRequestId: 0,
      repositoryChatRequest: null,
      chatSessionsLoadedFor: "id-token",
    })

    render(<ChatInterface />)

    fireEvent.click(screen.getByRole("button", { name: "Choose prod state" }))
    fireEvent.click(screen.getByRole("button", { name: "Type plan prompt" }))
    await waitFor(() =>
      expect(screen.getByRole("form", { name: "chat input" })).toHaveAttribute(
        "data-selected-state-backend",
        "backend-prod"
      )
    )
    fireEvent.click(screen.getByRole("button", { name: "Send prompt" }))

    await waitFor(() => expect(agentCoreClientMock.invoke).toHaveBeenCalled())
    expect(agentCoreClientMock.invoke).toHaveBeenCalledWith(
      "Run terraform plan",
      "session-state-send",
      "access-token",
      expect.any(Function),
      {
        owner: "png261",
        name: "hcp-terraform",
        fullName: "png261/hcp-terraform",
        defaultBranch: "main",
      },
      expect.objectContaining({ id: "agent1" }),
      [],
      expect.objectContaining({
        backendId: "backend-prod",
        bucket: "tf-prod-state",
        key: "env/prod/terraform.tfstate",
        region: "us-east-1",
      }),
      expect.any(AbortSignal)
    )
  })

  it("keeps a newly submitted assistant response pending while the runtime is active", async () => {
    let finishInvoke: (() => void) | null = null
    agentCoreClientMock.invoke.mockImplementation(
      async (
        _query: string,
        _sessionId: string,
        _accessToken: string,
        _onEvent: unknown,
        _repository: unknown,
        _agent: unknown,
        _attachments: unknown,
        _stateBackend: unknown,
        signal: AbortSignal
      ) => {
        await new Promise<void>((resolve, reject) => {
          finishInvoke = resolve
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
        })
      }
    )

    render(<ChatInterface />)

    fireEvent.click(screen.getByRole("button", { name: "Type plan prompt" }))
    await waitFor(() =>
      expect(screen.getByRole("form", { name: "chat input" })).toHaveAttribute("data-input", "Run terraform plan")
    )
    fireEvent.click(screen.getByRole("button", { name: "Send prompt" }))

    await waitFor(() => expect(agentCoreClientMock.invoke).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.getByRole("form", { name: "chat input" })).toHaveAttribute("data-is-loading", "true")
    )
    expect(screen.getByRole("status", { name: "thinking" })).toBeInTheDocument()
    expect(screen.queryByText("Stopped.")).not.toBeInTheDocument()
    expect(hasRunningSessionController("session-1")).toBe(true)

    act(() => {
      finishInvoke?.()
    })
    await waitFor(() => expect(hasRunningSessionController("session-1")).toBe(false))
  })

  it("starts a fresh empty store chat in the created session", async () => {
    let finishInvoke: (() => void) | null = null
    let invokedSessionId = ""
    agentCoreClientMock.invoke.mockImplementation(
      async (
        _query: string,
        sessionId: string,
        _accessToken: string,
        _onEvent: unknown,
        _repository: unknown,
        _agent: unknown,
        _attachments: unknown,
        _stateBackend: unknown,
        signal: AbortSignal
      ) => {
        invokedSessionId = sessionId
        await new Promise<void>((resolve, reject) => {
          finishInvoke = resolve
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
        })
      }
    )
    store.useWebAppStore.setState({
      sessions: [],
      activeSessionId: "",
      newChatRequestId: 0,
      repositoryChatRequest: null,
      chatSessionsLoadedFor: "id-token",
    })

    render(<ChatInterface />)

    fireEvent.click(screen.getByRole("button", { name: "Type plan prompt" }))
    await waitFor(() =>
      expect(screen.getByRole("form", { name: "chat input" })).toHaveAttribute("data-input", "Run terraform plan")
    )
    fireEvent.click(screen.getByRole("button", { name: "Send prompt" }))

    await waitFor(() => expect(agentCoreClientMock.invoke).toHaveBeenCalled())
    expect(invokedSessionId).toBeTruthy()
    await waitFor(() =>
      expect(store.useWebAppStore.getState().activeSessionId).toBe(invokedSessionId)
    )
    expect(
      store.useWebAppStore.getState().sessions.find((session: { id: string }) => session.id === invokedSessionId)
        ?.history.at(-1)?.content
    ).toBe("Thinking...")
    expect(screen.getByRole("status", { name: "thinking" })).toBeInTheDocument()
    expect(screen.queryByText("Stopped.")).not.toBeInTheDocument()

    act(() => {
      finishInvoke?.()
    })
    await waitFor(() => expect(hasRunningSessionController(invokedSessionId)).toBe(false))
  })

  it("shows runtime abort failures as errors instead of stopped messages", async () => {
    agentCoreClientMock.invoke.mockRejectedValue(new DOMException("Stream closed", "AbortError"))

    render(<ChatInterface />)

    fireEvent.click(screen.getByRole("button", { name: "Type plan prompt" }))
    await waitFor(() =>
      expect(screen.getByRole("form", { name: "chat input" })).toHaveAttribute("data-input", "Run terraform plan")
    )
    fireEvent.click(screen.getByRole("button", { name: "Send prompt" }))

    expect(await screen.findByText("I encountered an error processing your request: Stream closed")).toBeInTheDocument()
    expect(screen.queryByText("Stopped.")).not.toBeInTheDocument()
    expect(
      store.useWebAppStore
        .getState()
        .sessions.find((session: { id: string }) => session.id === "session-1")
        ?.history.at(-1)?.status
    ).toBe("error")
  })

  it("shows provider quota failures as runtime errors instead of stopped messages", async () => {
    agentCoreClientMock.invoke.mockRejectedValue(
      new Error("Error code: 402 - INSUFFICIENT_BALANCE")
    )

    render(<ChatInterface />)

    fireEvent.click(screen.getByRole("button", { name: "Type plan prompt" }))
    await waitFor(() =>
      expect(screen.getByRole("form", { name: "chat input" })).toHaveAttribute("data-input", "Run terraform plan")
    )
    fireEvent.click(screen.getByRole("button", { name: "Send prompt" }))

    expect(
      await screen.findByText("I encountered an error processing your request: Error code: 402 - INSUFFICIENT_BALANCE")
    ).toBeInTheDocument()
    expect(screen.queryByText("Stopped.")).not.toBeInTheDocument()
  })

  it("keeps the current chat running until the current session is stopped", async () => {
    let capturedSignal: AbortSignal | null = null
    agentCoreClientMock.invoke.mockImplementation(
      async (
        _query: string,
        _sessionId: string,
        _accessToken: string,
        _onEvent: unknown,
        _repository: unknown,
        _agent: unknown,
        _attachments: unknown,
        _stateBackend: unknown,
        signal: AbortSignal
      ) => {
        capturedSignal = signal
        await new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
        })
      }
    )
    store.useWebAppStore.setState({
      sessions: [
        {
          id: "session-running",
          name: "Running chat",
          history: [],
          startDate: "2026-05-11T04:00:00.000Z",
          endDate: "2026-05-11T04:00:00.000Z",
          repository: {
            owner: "png261",
            name: "hcp-terraform",
            fullName: "png261/hcp-terraform",
            defaultBranch: "main",
          },
        },
      ],
      activeSessionId: "session-running",
      newChatRequestId: 0,
      repositoryChatRequest: null,
      chatSessionsLoadedFor: "id-token",
    })

    const { rerender } = render(<ChatInterface />)

    fireEvent.click(screen.getByRole("button", { name: "Type plan prompt" }))
    await waitFor(() =>
      expect(screen.getByRole("form", { name: "chat input" })).toHaveAttribute("data-input", "Run terraform plan")
    )
    fireEvent.click(screen.getByRole("button", { name: "Send prompt" }))

    await waitFor(() =>
      expect(screen.getByRole("form", { name: "chat input" })).toHaveAttribute("data-is-loading", "true")
    )
    expect(capturedSignal?.aborted).toBe(false)

    store.useWebAppStore.setState({
      sessions: [
        ...(store.useWebAppStore.getState().sessions ?? []),
        {
          id: "session-idle",
          name: "Idle chat",
          history: [],
          startDate: "2026-05-11T04:05:00.000Z",
          endDate: "2026-05-11T04:05:00.000Z",
        },
      ],
      activeSessionId: "session-idle",
    })
    rerender(<ChatInterface />)

    await waitFor(() =>
      expect(screen.getByRole("form", { name: "chat input" })).toHaveAttribute("data-is-loading", "false")
    )
    expect(capturedSignal?.aborted).toBe(false)

    store.useWebAppStore.setState({
      activeSessionId: "session-running",
    })
    rerender(<ChatInterface />)

    await waitFor(() =>
      expect(screen.getByRole("form", { name: "chat input" })).toHaveAttribute("data-is-loading", "true")
    )

    fireEvent.click(screen.getByRole("button", { name: "Stop prompt" }))

    await waitFor(() => expect(capturedSignal?.aborted).toBe(true))
    await waitFor(() =>
      expect(screen.getByRole("form", { name: "chat input" })).toHaveAttribute("data-is-loading", "false")
    )
    expect(screen.getByText("Stopped.")).toBeInTheDocument()
  })

  it("keeps the stop controller after the chat component remounts", async () => {
    let capturedSignal: AbortSignal | null = null
    agentCoreClientMock.invoke.mockImplementation(
      async (
        _query: string,
        _sessionId: string,
        _accessToken: string,
        _onEvent: unknown,
        _repository: unknown,
        _agent: unknown,
        _attachments: unknown,
        _stateBackend: unknown,
        signal: AbortSignal
      ) => {
        capturedSignal = signal
        await new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
        })
      }
    )
    store.useWebAppStore.setState({
      sessions: [
        {
          id: "session-remount-stop",
          name: "Remount stop chat",
          history: [],
          startDate: "2026-05-11T04:00:00.000Z",
          endDate: "2026-05-11T04:00:00.000Z",
          repository: {
            owner: "png261",
            name: "hcp-terraform",
            fullName: "png261/hcp-terraform",
            defaultBranch: "main",
          },
        },
      ],
      activeSessionId: "session-remount-stop",
      newChatRequestId: 0,
      repositoryChatRequest: null,
      chatSessionsLoadedFor: "id-token",
    })

    const { unmount } = render(<ChatInterface />)

    fireEvent.click(screen.getByRole("button", { name: "Type plan prompt" }))
    await waitFor(() =>
      expect(screen.getByRole("form", { name: "chat input" })).toHaveAttribute("data-input", "Run terraform plan")
    )
    fireEvent.click(screen.getByRole("button", { name: "Send prompt" }))
    await waitFor(() =>
      expect(screen.getByRole("form", { name: "chat input" })).toHaveAttribute("data-is-loading", "true")
    )
    expect(capturedSignal?.aborted).toBe(false)

    unmount()
    const remounted = render(<ChatInterface />)

    await waitFor(() =>
      expect(screen.getByRole("form", { name: "chat input" })).toHaveAttribute("data-is-loading", "true")
    )
    fireEvent.click(screen.getByRole("button", { name: "Stop prompt" }))

    await waitFor(() => expect(capturedSignal?.aborted).toBe(true))
    await waitFor(() =>
      expect(screen.getByRole("form", { name: "chat input" })).toHaveAttribute("data-is-loading", "false")
    )
    await waitFor(() =>
      expect(
        store.useWebAppStore
          .getState()
          .sessions.find((session: { id: string }) => session.id === "session-remount-stop")
          ?.history.at(-1)?.content
      ).toBe("Stopped.")
    )
    remounted.rerender(<ChatInterface />)
    expect(await screen.findByText("Stopped.")).toBeInTheDocument()
  })

  it("clears a stale pending assistant response after a browser reload", async () => {
    store.useWebAppStore.setState({
      sessions: [
        {
          id: "session-reloaded-pending",
          name: "Reloaded pending chat",
          history: [
            {
              role: "user",
              content: "Run terraform plan",
              timestamp: "2026-05-11T04:00:00.000Z",
            },
            {
              role: "assistant",
              content: "Thinking...",
              status: "pending",
              timestamp: "2026-05-11T04:00:01.000Z",
            },
          ],
          startDate: "2026-05-11T04:00:00.000Z",
          endDate: "2026-05-11T04:00:01.000Z",
          repository: {
            owner: "png261",
            name: "hcp-terraform",
            fullName: "png261/hcp-terraform",
            defaultBranch: "main",
          },
        },
      ],
      activeSessionId: "session-reloaded-pending",
      newChatRequestId: 0,
      repositoryChatRequest: null,
      chatSessionsLoadedFor: "id-token",
    })

    render(<ChatInterface />)

    await waitFor(() =>
      expect(screen.queryByRole("status", { name: "thinking" })).not.toBeInTheDocument()
    )
    expect(screen.getByRole("form", { name: "chat input" })).toHaveAttribute("data-is-loading", "false")
    expect(screen.getByText("Stopped.")).toBeInTheDocument()
    expect(
      store.useWebAppStore
        .getState()
        .sessions.find((session: { id: string }) => session.id === "session-reloaded-pending")
        ?.history.at(-1)
    ).toMatchObject({ content: "Stopped.", status: "stopped" })
    expect(agentCoreClientMock.invoke).not.toHaveBeenCalled()
  })

  it("saves streamed assistant text to the original chat after switching sessions", async () => {
    let capturedOnEvent: ((event: { type: "text"; content: string }) => void) | null = null
    let finishInvoke: (() => void) | null = null
    agentCoreClientMock.invoke.mockImplementation(
      async (
        _query: string,
        _sessionId: string,
        _accessToken: string,
        onEvent: (event: { type: "text"; content: string }) => void
      ) => {
        capturedOnEvent = onEvent
        await new Promise<void>(resolve => {
          finishInvoke = resolve
        })
      }
    )
    store.useWebAppStore.setState({
      sessions: [
        {
          id: "session-streaming",
          name: "Streaming chat",
          history: [],
          startDate: "2026-05-11T04:00:00.000Z",
          endDate: "2026-05-11T04:00:00.000Z",
          repository: {
            owner: "png261",
            name: "hcp-terraform",
            fullName: "png261/hcp-terraform",
            defaultBranch: "main",
          },
        },
      ],
      activeSessionId: "session-streaming",
      newChatRequestId: 0,
      repositoryChatRequest: null,
      chatSessionsLoadedFor: "id-token",
    })

    const { rerender } = render(<ChatInterface />)

    fireEvent.click(screen.getByRole("button", { name: "Type plan prompt" }))
    await waitFor(() =>
      expect(screen.getByRole("form", { name: "chat input" })).toHaveAttribute("data-input", "Run terraform plan")
    )
    fireEvent.click(screen.getByRole("button", { name: "Send prompt" }))
    await waitFor(() => expect(capturedOnEvent).not.toBeNull())

    store.useWebAppStore.setState({
      sessions: [
        ...(store.useWebAppStore.getState().sessions ?? []),
        {
          id: "session-other",
          name: "Other chat",
          history: [],
          startDate: "2026-05-11T04:05:00.000Z",
          endDate: "2026-05-11T04:05:00.000Z",
        },
      ],
      activeSessionId: "session-other",
    })
    rerender(<ChatInterface />)
    await waitFor(() =>
      expect(screen.getByRole("form", { name: "chat input" })).toHaveAttribute("data-is-loading", "false")
    )

    act(() => {
      capturedOnEvent?.({ type: "text", content: "Plan finished after switching chats." })
      finishInvoke?.()
    })

    await waitFor(() =>
      expect(
        store.useWebAppStore
          .getState()
          .sessions.find((session: { id: string }) => session.id === "session-streaming")
          ?.history.at(-1)?.content
      ).toBe("Plan finished after switching chats.")
    )

    store.useWebAppStore.setState({
      activeSessionId: "session-streaming",
    })
    rerender(<ChatInterface />)

    expect(await screen.findByText("Plan finished after switching chats.")).toBeInTheDocument()
    expect(screen.queryByText("Thinking...")).not.toBeInTheDocument()
  })
})
