import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import ChatInterface from "@/components/chat/ChatInterface"

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

vi.mock("@/components/files/FileSystemPanel", () => ({
  FileSystemPanel: () => <div data-testid="filesystem-panel" />,
}))

vi.mock("@/components/chat/ChatInput", () => ({
  ChatInput: ({
    repositoryLocked,
    selectedRepositoryFullName,
    onRepositoryChange,
  }: {
    repositoryLocked?: boolean
    selectedRepositoryFullName?: string
    onRepositoryChange?: (value: string) => void
  }) => (
    <form
      aria-label="chat input"
      data-repository-locked={String(Boolean(repositoryLocked))}
      data-selected-repository={selectedRepositoryFullName}
    >
      <button
        type="button"
        onClick={() => onRepositoryChange?.("png261/hcp-terraform")}
      >
        Choose hcp-terraform
      </button>
    </form>
  ),
}))

describe("ChatInterface new repository chat", () => {
  beforeEach(() => {
    agentCoreClientMock.githubAction.mockClear()
    agentCoreClientMock.invoke.mockClear()
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
          agentRuntimeArn: "arn:aws:bedrock-agentcore:us-east-2:123456789012:runtime/test",
          awsRegion: "us-east-2",
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

    expect(screen.getByText("Infrastructure Agent")).toBeInTheDocument()
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

    render(<ChatInterface />)

    expect(screen.getByText("Infrastructure Agent")).toBeInTheDocument()
    expect(screen.queryByText("Ask me anything to get started")).not.toBeInTheDocument()
    expect(screen.getByRole("form", { name: "chat input" })).toBeInTheDocument()
    expect(screen.getByText(/No repository connected/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Connect Repository" })).toBeInTheDocument()
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
    expect(screen.getByRole("button", { name: "Connect Repository" })).toBeEnabled()
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
})
