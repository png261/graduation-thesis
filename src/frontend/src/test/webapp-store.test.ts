import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ChatSession } from "@/components/chat/types"

const resources = vi.hoisted(() => ({
  listChatSessions: vi.fn(),
  saveChatSessions: vi.fn(),
}))

const storage = vi.hoisted(() => {
  let items: Record<string, string> = {}
  return {
    localStorage: {
      getItem: vi.fn((key: string) => items[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        items[key] = value
      }),
      removeItem: vi.fn((key: string) => {
        delete items[key]
      }),
      clear: vi.fn(() => {
        items = {}
      }),
    },
  }
})

vi.mock("@/services/resourcesService", () => ({
  getUserConfig: vi.fn(),
  GitHubPullRequestStatus: {},
  deleteChatSession: vi.fn(),
  listChatSessions: resources.listChatSessions,
  listGitHubPullRequests: vi.fn(),
  saveChatSessions: resources.saveChatSessions,
  saveUserConfig: vi.fn(),
}))

vi.stubGlobal("localStorage", storage.localStorage)

const { useWebAppStore } = await import("@/stores/webAppStore")

function sessionWithAssistant(content: string): ChatSession {
  return {
    id: "session-streaming",
    name: "Streaming chat",
    history: [
      {
        role: "user",
        content: "Run terraform plan",
        timestamp: "2026-05-11T04:00:00.000Z",
      },
      {
        role: "assistant",
        content,
        timestamp: "2026-05-11T04:00:01.000Z",
      },
    ],
    startDate: "2026-05-11T04:00:00.000Z",
    endDate: "2026-05-11T04:00:01.000Z",
    repository: null,
    pullRequest: null,
  }
}

function sessionWithStateBackend(): ChatSession {
  return {
    id: "session-state-backend",
    name: "State backend chat",
    history: [],
    startDate: "2026-05-15T04:00:00.000Z",
    endDate: "2026-05-15T04:00:00.000Z",
    repository: null,
    stateBackend: {
      backendId: "backend-1",
      name: "Dev state",
      bucket: "terraform-state-demo",
      key: "env/dev.tfstate",
      region: "us-east-1",
      service: "s3",
      credentialId: "cred-1",
    },
    pullRequest: null,
  }
}

describe("web app store chat persistence", () => {
  beforeEach(() => {
    resources.listChatSessions.mockReset()
    resources.saveChatSessions.mockReset()
    storage.localStorage.clear()
    useWebAppStore.setState({
      sessions: [],
      activeSessionId: "",
      chatSessionsLoadedFor: "",
      repositoryChatRequest: null,
      newChatRequestId: 0,
    })
  })

  it("does not let an older save response overwrite newer streamed chat content", async () => {
    let releaseSave: (() => void) | null = null
    resources.saveChatSessions.mockImplementation(async payload => {
      const response = JSON.parse(JSON.stringify(payload))
      await new Promise<void>(resolve => {
        releaseSave = resolve
      })
      return response
    })

    useWebAppStore.setState({
      sessions: [sessionWithAssistant("Thinking...")],
      activeSessionId: "session-streaming",
    })

    const persistPromise = useWebAppStore.getState().persistChatSessions("id-token")

    useWebAppStore.setState({
      sessions: [sessionWithAssistant("Plan finished after switching chats.")],
      activeSessionId: "session-streaming",
    })
    releaseSave?.()
    await persistPromise

    expect(useWebAppStore.getState().sessions[0].history.at(-1)?.content).toBe(
      "Plan finished after switching chats."
    )
    expect(useWebAppStore.getState().chatSessionsLoadedFor).toBe("id-token")
  })

  it("does not let a delayed hydrate response overwrite a locally started chat", async () => {
    let releaseHydrate: (() => void) | null = null
    resources.listChatSessions.mockImplementation(async () => {
      await new Promise<void>(resolve => {
        releaseHydrate = resolve
      })
      return {
        sessions: [
          {
            id: "saved-session",
            name: "Saved chat",
            history: [
              {
                role: "user",
                content: "Old prompt",
                timestamp: "2026-05-11T03:00:00.000Z",
              },
            ],
            startDate: "2026-05-11T03:00:00.000Z",
            endDate: "2026-05-11T03:00:00.000Z",
            repository: null,
            pullRequest: null,
          },
        ],
        activeSessionId: "saved-session",
      }
    })

    const hydratePromise = useWebAppStore.getState().hydrateChatSessions("id-token")

    useWebAppStore.setState({
      sessions: [sessionWithAssistant("Thinking...")],
      activeSessionId: "session-streaming",
    })
    releaseHydrate?.()
    await hydratePromise

    const state = useWebAppStore.getState()
    expect(state.activeSessionId).toBe("session-streaming")
    expect(state.sessions.map(session => session.id)).toEqual(["session-streaming", "saved-session"])
    expect(state.sessions[0].history.at(-1)?.content).toBe("Thinking...")
    expect(state.chatSessionsLoadedFor).toBe("id-token")
  })

  it("keeps state-backend-only chats when hydrating saved sessions", async () => {
    resources.listChatSessions.mockResolvedValue({
      sessions: [],
      activeSessionId: "",
    })
    useWebAppStore.setState({
      sessions: [sessionWithStateBackend()],
      activeSessionId: "session-state-backend",
    })

    await useWebAppStore.getState().hydrateChatSessions("id-token", { force: true })

    const state = useWebAppStore.getState()
    expect(state.activeSessionId).toBe("session-state-backend")
    expect(state.sessions[0].stateBackend?.backendId).toBe("backend-1")
  })
})
