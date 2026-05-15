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
        const existingEmptySession = state.sessions.find(
          (session: any) => !session.repository && !session.pullRequest && (session.history?.length ?? 0) === 0
        )
        const now = new Date().toISOString()
        const nextSession = existingEmptySession ?? {
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
            ...state.sessions.filter((session: any) => session.id !== nextSession.id),
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
    expect(screen.getByText("New chat")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^new chat$/i })).toBeDisabled()
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

  it("does not create a second empty new chat", async () => {
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
    expect(newChatButton).toBeDisabled()

    fireEvent.click(newChatButton)

    await waitFor(() => {
      expect(useWebAppStore.getState().sessions.filter(session => !session.repository && session.history.length === 0)).toHaveLength(1)
    })
  })

  it("deletes a chat from the sidebar without recreating it", async () => {
    useWebAppStore.setState({
      sessions: [
        {
          id: "active-session",
          name: "Active chat",
          history: [],
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
          history: [],
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

    fireEvent.click(screen.getByRole("button", { name: "Delete Old chat" }))

    await waitFor(() => {
      expect(useWebAppStore.getState().sessions.map(session => session.id)).toEqual(["active-session"])
    })
    expect(screen.queryByText("Old chat")).not.toBeInTheDocument()
    expect(useWebAppStore.getState().activeSessionId).toBe("active-session")
    expect(useWebAppStore.getState().deleteChatSession).toHaveBeenCalledWith("old-session", "id-token")
  })

  it("switches to the next chat when deleting the active chat", async () => {
    useWebAppStore.setState({
      sessions: [
        {
          id: "active-session",
          name: "Active chat",
          history: [],
          startDate: "2026-05-11T06:00:00.000Z",
          endDate: "2026-05-11T06:00:00.000Z",
          repository: null,
          pullRequest: null,
        },
        {
          id: "next-session",
          name: "Next chat",
          history: [],
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

    fireEvent.click(screen.getByRole("button", { name: "Delete Active chat" }))

    await waitFor(() => {
      expect(useWebAppStore.getState().sessions.map(session => session.id)).toEqual(["next-session"])
      expect(useWebAppStore.getState().activeSessionId).toBe("next-session")
    })
    expect(screen.queryByText("Active chat")).not.toBeInTheDocument()
  })
})
