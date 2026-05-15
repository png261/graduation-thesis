import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { BrowserRouter } from "react-router-dom"
import ChatInterface from "@/components/chat/ChatInterface"
import { AppSidebar } from "@/components/layout/AppSidebar"
import { useWebAppStore } from "@/stores/webAppStore"
import { reconcileRunningSessions, registerRunningSession, unregisterRunningSession } from "@/components/chat/running-sessions"

vi.mock("@/stores/webAppStore", async () => {
  const { create } = await vi.importActual<typeof import("zustand")>("zustand")
  const useWebAppStore = create<any>((set, get) => ({
    sessions: [],
    activeSessionId: "",
    newChatRequestId: 0,
    repositoryChatRequest: null,
    chatSessionsLoadedFor: "",
    selectedRepository: null,
    userConfigLoadedFor: "",
    pullRequestsByKey: {},
    setSessions: (sessions: unknown[]) => set({ sessions }),
    setActiveSessionId: (activeSessionId: string) => set({ activeSessionId }),
    requestNewChat: () =>
      set(state => {
        const now = new Date().toISOString()
        const nextSession = {
          id: crypto.randomUUID(),
          name: "New chat",
          history: [],
          startDate: now,
          endDate: now,
          repository: null,
          pullRequest: null,
        }
        return {
          sessions: [
            nextSession,
            ...state.sessions,
          ],
          activeSessionId: nextSession.id,
          newChatRequestId: Date.now(),
        }
      }),
    requestRepositoryChat: vi.fn(),
    upsertSession: vi.fn(),
    deleteSession: (sessionId: string) => set(state => {
      const nextSessions = state.sessions.filter((session: any) => session.id !== sessionId)
      return {
        sessions: nextSessions,
        activeSessionId:
          state.activeSessionId === sessionId
            ? nextSessions[0]?.id ?? ""
            : state.activeSessionId,
      }
    }),
    deleteChatSession: vi.fn(async (sessionId: string) => {
      const nextSessions = get().sessions.filter((session: any) => session.id !== sessionId)
      const activeSessionId =
        get().activeSessionId === sessionId
          ? nextSessions[0]?.id ?? ""
          : get().activeSessionId
      set({
        sessions: nextSessions,
        activeSessionId,
        chatSessionsLoadedFor: "id-token",
      })
      return {
        sessions: nextSessions,
        activeSessionId,
      }
    }),
    hydrateChatSessions: vi.fn(async () => ({
      sessions: get().sessions,
      activeSessionId: get().activeSessionId,
    })),
    persistChatSessions: vi.fn(async () => ({
      sessions: get().sessions,
      activeSessionId: get().activeSessionId,
    })),
    setSelectedRepository: vi.fn(),
    hydrateUserConfig: vi.fn(async () => undefined),
    persistSelectedRepository: vi.fn(async () => undefined),
    pullRequestCacheKey: (repository: string, state: string) => `${repository}::${state}`,
    loadPullRequests: vi.fn(async () => []),
  }))
  return { useWebAppStore }
})

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    signOut: vi.fn(),
    user: {
      id_token: "id-token",
      profile: { email: "user@example.com" },
    },
  }),
}))

vi.mock("react-oidc-context", () => ({
  useAuth: () => ({
    user: {
      access_token: "access-token",
      id_token: "id-token",
    },
  }),
}))

vi.mock("@/app/context/GlobalContext", () => ({
  useGlobal: () => ({ isLoading: false, setIsLoading: vi.fn() }),
}))

vi.mock("@/hooks/useToolRenderer", () => ({
  useDefaultTool: vi.fn(),
}))

vi.mock("@/lib/agentcore-client", () => ({
  AgentCoreClient: vi.fn().mockImplementation(function AgentCoreClient() {
    return {
      githubAction: vi.fn(async () => ({ repositories: [] })),
      cancelSession: vi.fn(async () => undefined),
      invoke: vi.fn(),
    }
  }),
}))

vi.mock("@/components/files/FileSystemPanel", () => ({
  FileSystemPanel: () => <div data-testid="filesystem-panel" />,
}))

vi.mock("@/components/chat/ChatInput", () => ({
  ChatInput: () => <form aria-label="chat input" />,
}))

vi.mock("@/components/ui/cursor-driven-particle-typography", () => ({
  CursorDrivenParticleTypography: ({ text }: { text: string }) => <div>{text}</div>,
}))

const answeredHistory = [
  {
    role: "user" as const,
    content: "Run terraform plan",
    timestamp: "2026-05-11T04:00:00.000Z",
  },
  {
    role: "assistant" as const,
    content: "Plan complete.",
    status: "complete" as const,
    timestamp: "2026-05-11T04:01:00.000Z",
  },
]

describe("New Chat from sidebar", () => {
  beforeEach(() => {
    reconcileRunningSessions([])
    unregisterRunningSession("repo-session")
    unregisterRunningSession("empty-new-chat")
    unregisterRunningSession("active-session")
    unregisterRunningSession("old-session")
    unregisterRunningSession("next-session")
    useWebAppStore.setState({
      sessions: [
        {
          id: "repo-session",
          name: "Repository chat",
          history: answeredHistory,
          startDate: "2026-05-11T04:00:00.000Z",
          endDate: "2026-05-11T04:00:00.000Z",
          repository: {
            owner: "png261",
            name: "hcp-terraform",
            fullName: "png261/hcp-terraform",
            defaultBranch: "main",
          },
          stateBackend: {
            backendId: "backend-1",
            name: "prod-state",
            bucket: "terraform-state",
            key: "prod/terraform.tfstate",
            region: "ap-southeast-1",
          },
        },
      ],
      activeSessionId: "repo-session",
      newChatRequestId: 0,
      repositoryChatRequest: null,
      chatSessionsLoadedFor: "id-token",
    })
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
  })

  it("keeps the chat screen visible after creating a repository-less chat", async () => {
    render(
      <BrowserRouter>
        <AppSidebar />
        <ChatInterface />
      </BrowserRouter>
    )

    fireEvent.click(screen.getByRole("button", { name: /new chat/i }))

    await waitFor(() => {
      expect(screen.queryByText(/No repository connected/i)).not.toBeInTheDocument()
    })
    expect(screen.getByRole("form", { name: "chat input" })).toBeInTheDocument()
    expect(screen.getAllByText("InfraQ").length).toBeGreaterThan(0)
    expect(screen.getByRole("button", { name: /^new chat$/i })).toBeEnabled()
    expect(useWebAppStore.getState().sessions.filter(session => !session.repository && session.history.length === 0)).toHaveLength(1)
  })

  it("keeps the desktop sidebar fixed and marks responding chats", () => {
    registerRunningSession("repo-session", new AbortController())

    render(
      <BrowserRouter>
        <AppSidebar />
      </BrowserRouter>
    )

    expect(screen.getByRole("complementary")).toHaveClass("fixed")
    expect(screen.getByLabelText("Agent responding")).toBeInTheDocument()
    expect(screen.getByText("Responding...")).toBeInTheDocument()

    unregisterRunningSession("repo-session")
  })

  it("orders the menu like ChatGPT with recents after settings", () => {
    render(
      <BrowserRouter>
        <AppSidebar />
      </BrowserRouter>
    )

    const sidebar = screen.getByRole("complementary")
    const newChat = screen.getByRole("button", { name: /^new chat$/i })
    const pullRequests = screen.getByRole("link", { name: "Pull Requests" })
    const resourceCatalog = screen.getByRole("link", { name: "Resource Catalog" })
    const settings = screen.getByRole("link", { name: "Settings" })
    const recents = screen.getByText("Recents")
    const chat = screen.getByRole("button", { name: "Open chat Repository chat" })

    expect(sidebar).toHaveTextContent(/New Chat[\s\S]*Pull Requests[\s\S]*Resource Catalog[\s\S]*Settings[\s\S]*Recents/i)
    expect(chat).toHaveTextContent("Repository chat")
    expect(chat).toHaveTextContent("prod-state · png261/hcp-terraform")
    expect(newChat.compareDocumentPosition(pullRequests) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(pullRequests.compareDocumentPosition(resourceCatalog) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(resourceCatalog.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(settings.compareDocumentPosition(recents) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(recents.compareDocumentPosition(chat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("does not mark a stale reloaded pending chat as responding without a live run", () => {
    useWebAppStore.setState({
      sessions: [
        {
          id: "repo-session",
          name: "Repository chat",
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
      activeSessionId: "repo-session",
    })

    render(
      <BrowserRouter>
        <AppSidebar />
      </BrowserRouter>
    )

    expect(screen.queryByLabelText("Agent responding")).not.toBeInTheDocument()
    expect(screen.queryByText("Responding...")).not.toBeInTheDocument()
  })

  it("adds chats to recents only after the first agent response", () => {
    useWebAppStore.setState({
      sessions: [
        {
          id: "agent-response",
          name: "Answered chat",
          history: [
            {
              role: "user",
              content: "Run terraform plan",
              timestamp: "2026-05-11T04:00:00.000Z",
            },
            {
              role: "assistant",
              content: "The plan is ready.",
              status: "complete",
              timestamp: "2026-05-11T04:01:00.000Z",
            },
          ],
          startDate: "2026-05-11T04:00:00.000Z",
          endDate: "2026-05-11T04:01:00.000Z",
          repository: null,
          pullRequest: null,
        },
        {
          id: "user-only",
          name: "User only chat",
          history: [
            {
              role: "user",
              content: "Run terraform plan",
              timestamp: "2026-05-11T04:02:00.000Z",
            },
          ],
          startDate: "2026-05-11T04:02:00.000Z",
          endDate: "2026-05-11T04:02:00.000Z",
          repository: null,
          pullRequest: null,
        },
        {
          id: "empty-draft",
          name: "Empty draft",
          history: [],
          startDate: "2026-05-11T04:03:00.000Z",
          endDate: "2026-05-11T04:03:00.000Z",
          repository: null,
          pullRequest: null,
        },
        {
          id: "placeholder",
          name: "Placeholder chat",
          history: [
            {
              role: "user",
              content: "Run terraform plan",
              timestamp: "2026-05-11T04:04:00.000Z",
            },
            {
              role: "assistant",
              content: "Thinking...",
              status: "pending",
              timestamp: "2026-05-11T04:04:01.000Z",
            },
          ],
          startDate: "2026-05-11T04:04:00.000Z",
          endDate: "2026-05-11T04:04:01.000Z",
          repository: null,
          pullRequest: null,
        },
      ],
      activeSessionId: "agent-response",
    })

    render(
      <BrowserRouter>
        <AppSidebar />
      </BrowserRouter>
    )

    expect(screen.getByRole("button", { name: "Open chat Answered chat" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Open chat User only chat" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Open chat Empty draft" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Open chat Placeholder chat" })).not.toBeInTheDocument()
  })

  it("keeps new chat active and creates another empty draft without adding drafts to recents", async () => {
    useWebAppStore.setState({
      sessions: [
        {
          id: "empty-new-chat",
          name: "New chat",
          history: [],
          startDate: "2026-05-11T05:00:00.000Z",
          endDate: "2026-05-11T05:00:00.000Z",
          repository: null,
          pullRequest: null,
        },
      ],
      activeSessionId: "empty-new-chat",
      newChatRequestId: 0,
      repositoryChatRequest: null,
      chatSessionsLoadedFor: "id-token",
    })

    render(
      <BrowserRouter>
        <AppSidebar />
        <ChatInterface />
      </BrowserRouter>
    )

    const newChatButton = screen.getByRole("button", { name: /^new chat$/i })
    expect(newChatButton).toBeEnabled()
    expect(screen.queryByRole("button", { name: "Open chat New chat" })).not.toBeInTheDocument()

    fireEvent.click(newChatButton)

    await waitFor(() => {
      expect(useWebAppStore.getState().sessions.filter(session => !session.repository && session.history.length === 0)).toHaveLength(2)
    })
    expect(screen.queryByRole("button", { name: "Open chat New chat" })).not.toBeInTheDocument()
  })

  it("deletes a chat from the sidebar without recreating it", async () => {
    useWebAppStore.setState({
      sessions: [
        {
          id: "active-session",
          name: "Active chat",
          history: answeredHistory,
          startDate: "2026-05-11T06:00:00.000Z",
          endDate: "2026-05-11T06:00:00.000Z",
          repository: {
            owner: "png261",
            name: "hcp-terraform",
            fullName: "png261/hcp-terraform",
            defaultBranch: "main",
          },
        },
        {
          id: "old-session",
          name: "Old chat",
          history: answeredHistory,
          startDate: "2026-05-11T05:00:00.000Z",
          endDate: "2026-05-11T05:00:00.000Z",
          repository: null,
          pullRequest: null,
        },
      ],
      activeSessionId: "active-session",
      newChatRequestId: 0,
      repositoryChatRequest: null,
      chatSessionsLoadedFor: "id-token",
    })

    render(
      <BrowserRouter>
        <AppSidebar />
        <ChatInterface />
      </BrowserRouter>
    )

    fireEvent.click(screen.getByRole("button", { name: "Chat actions for Old chat" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))

    await waitFor(() => {
      expect(useWebAppStore.getState().sessions.map(session => session.id)).toEqual(["active-session"])
    })
    expect(screen.queryByText("Old chat")).not.toBeInTheDocument()
    expect(useWebAppStore.getState().activeSessionId).toBe("active-session")
    expect(useWebAppStore.getState().deleteChatSession).toHaveBeenCalledWith("old-session", "id-token")
  })

  it("shows a chat action menu for pinning and renaming recents", async () => {
    useWebAppStore.setState({
      sessions: [
        {
          id: "newer-session",
          name: "Newer chat",
          history: answeredHistory,
          startDate: "2026-05-11T07:00:00.000Z",
          endDate: "2026-05-11T07:00:00.000Z",
          repository: null,
          pullRequest: null,
        },
        {
          id: "older-session",
          name: "Older chat",
          history: answeredHistory,
          startDate: "2026-05-11T06:00:00.000Z",
          endDate: "2026-05-11T06:00:00.000Z",
          repository: null,
          pullRequest: null,
        },
      ],
      activeSessionId: "newer-session",
      chatSessionsLoadedFor: "id-token",
    })
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("Renamed older chat")

    render(
      <BrowserRouter>
        <AppSidebar />
      </BrowserRouter>
    )

    const newer = screen.getByRole("button", { name: "Open chat Newer chat" })
    const older = screen.getByRole("button", { name: "Open chat Older chat" })
    expect(newer.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Chat actions for Older chat" }))
    fireEvent.click(screen.getByRole("button", { name: "Pin" }))

    await waitFor(() => {
      expect(useWebAppStore.getState().sessions.find(session => session.id === "older-session")?.pinned).toBe(true)
    })
    const pinnedOlder = screen.getByRole("button", { name: "Open chat Older chat" })
    const unpinnedNewer = screen.getByRole("button", { name: "Open chat Newer chat" })
    expect(pinnedOlder.compareDocumentPosition(unpinnedNewer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Rename" }))

    await waitFor(() => {
      expect(useWebAppStore.getState().sessions.find(session => session.id === "older-session")?.name).toBe("Renamed older chat")
    })
    expect(screen.getByRole("button", { name: "Open chat Renamed older chat" })).toBeInTheDocument()
    expect(useWebAppStore.getState().persistChatSessions).toHaveBeenCalledWith("id-token")
    promptSpy.mockRestore()
  })

  it("switches to the next chat when deleting the active chat", async () => {
    useWebAppStore.setState({
      sessions: [
        {
          id: "active-session",
          name: "Active chat",
          history: answeredHistory,
          startDate: "2026-05-11T06:00:00.000Z",
          endDate: "2026-05-11T06:00:00.000Z",
          repository: null,
          pullRequest: null,
        },
        {
          id: "next-session",
          name: "Next chat",
          history: answeredHistory,
          startDate: "2026-05-11T05:00:00.000Z",
          endDate: "2026-05-11T05:00:00.000Z",
          repository: null,
          pullRequest: null,
        },
      ],
      activeSessionId: "active-session",
      newChatRequestId: 0,
      repositoryChatRequest: null,
      chatSessionsLoadedFor: "id-token",
    })

    render(
      <BrowserRouter>
        <AppSidebar />
        <ChatInterface />
      </BrowserRouter>
    )

    fireEvent.click(screen.getByRole("button", { name: "Chat actions for Active chat" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))

    await waitFor(() => {
      expect(useWebAppStore.getState().sessions.map(session => session.id)).toEqual(["next-session"])
      expect(useWebAppStore.getState().activeSessionId).toBe("next-session")
    })
    expect(screen.queryByText("Active chat")).not.toBeInTheDocument()
  })
})
