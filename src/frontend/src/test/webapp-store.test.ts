import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ChatSession } from "@/components/chat/types"

const resources = vi.hoisted(() => ({
  listAwsCredentials: vi.fn(),
  listChatSessions: vi.fn(),
  listDriftGuards: vi.fn(),
  listResourceScans: vi.fn(),
  listStateBackendResources: vi.fn(),
  listStateBackends: vi.fn(),
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
  listAwsCredentials: resources.listAwsCredentials,
  listChatSessions: resources.listChatSessions,
  listDriftGuards: resources.listDriftGuards,
  listGitHubPullRequests: vi.fn(),
  listResourceScans: resources.listResourceScans,
  listStateBackendResources: resources.listStateBackendResources,
  listStateBackends: resources.listStateBackends,
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
    resources.listAwsCredentials.mockReset()
    resources.listDriftGuards.mockReset()
    resources.listResourceScans.mockReset()
    resources.listStateBackendResources.mockReset()
    resources.listStateBackends.mockReset()
    resources.saveChatSessions.mockReset()
    storage.localStorage.clear()
    useWebAppStore.setState({
      sessions: [],
      activeSessionId: "",
      chatSessionsLoadedFor: "",
      repositoryChatRequest: null,
      newChatRequestId: 0,
      resourceCatalog: {
        backends: [],
        stateResources: [],
        scans: [],
        guards: [],
        credentials: [],
      },
      resourceCatalogLoadedFor: "",
      resourceCatalogFetchedAt: 0,
      isResourceCatalogLoading: false,
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

  it("restores local image attachments when saved sessions omit attachment data", async () => {
    resources.listChatSessions.mockResolvedValue({
      sessions: [
        {
          id: "session-with-image",
          name: "Image chat",
          history: [
            {
              role: "user",
              content: "Review this image",
              timestamp: "2026-05-15T04:00:00.000Z",
            },
          ],
          startDate: "2026-05-15T04:00:00.000Z",
          endDate: "2026-05-15T04:00:00.000Z",
          repository: null,
          pullRequest: null,
        },
      ],
      activeSessionId: "session-with-image",
    })
    useWebAppStore.setState({
      sessions: [
        {
          id: "session-with-image",
          name: "Image chat",
          history: [
            {
              role: "user",
              content: "Review this image",
              timestamp: "2026-05-15T04:00:00.000Z",
              attachments: [
                {
                  id: "image-1",
                  name: "diagram.png",
                  type: "image/png",
                  size: 128,
                  dataUrl: "data:image/png;base64,iVBORw0KGgo=",
                },
              ],
            },
          ],
          startDate: "2026-05-15T04:00:00.000Z",
          endDate: "2026-05-15T04:00:00.000Z",
          repository: null,
          pullRequest: null,
        },
      ],
      activeSessionId: "session-with-image",
    })

    await useWebAppStore.getState().hydrateChatSessions("id-token", { force: true })

    expect(useWebAppStore.getState().sessions[0].history[0].attachments?.[0]).toMatchObject({
      name: "diagram.png",
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
    })
  })

  it("does not persist large image data URLs into browser storage or remote chat history", async () => {
    const largeDataUrl = `data:image/png;base64,${"a".repeat(600 * 1024)}`
    resources.saveChatSessions.mockImplementation(async payload => JSON.parse(JSON.stringify(payload)))

    useWebAppStore.getState().setSessions([
      {
        id: "session-large-image",
        name: "Large image chat",
        history: [
          {
            role: "user",
            content: "Give me terraform code for this architecture [Image #1]",
            timestamp: "2026-05-15T04:00:00.000Z",
            attachments: [
              {
                id: "image-1",
                name: "architecture.png",
                type: "image/png",
                size: 460000,
                dataUrl: largeDataUrl,
              },
            ],
          },
        ],
        startDate: "2026-05-15T04:00:00.000Z",
        endDate: "2026-05-15T04:00:00.000Z",
        repository: null,
        pullRequest: null,
      },
    ])
    useWebAppStore.getState().setActiveSessionId("session-large-image")

    expect(JSON.stringify(storage.localStorage.setItem.mock.calls)).not.toContain(largeDataUrl)

    await useWebAppStore.getState().persistChatSessions("id-token")

    const savedPayload = resources.saveChatSessions.mock.calls[0][0]
    const savedAttachment = savedPayload.sessions[0].history[0].attachments[0]
    expect(savedAttachment).toMatchObject({
      id: "image-1",
      name: "architecture.png",
      type: "image/png",
      size: 460000,
    })
    expect(savedAttachment.dataUrl).toBeUndefined()
  })

  it("keeps locally completed last messages when saved session is stale after reload", async () => {
    resources.listChatSessions.mockResolvedValue({
      sessions: [
        {
          id: "session-with-last-message",
          name: "Reload chat",
          history: [
            {
              role: "user",
              content: "Earlier message",
              timestamp: "2026-05-15T04:00:00.000Z",
            },
            {
              role: "assistant",
              content: "Earlier response",
              timestamp: "2026-05-15T04:00:01.000Z",
              status: "complete",
            },
          ],
          startDate: "2026-05-15T04:00:00.000Z",
          endDate: "2026-05-15T04:00:01.000Z",
          repository: null,
          pullRequest: null,
        },
      ],
      activeSessionId: "session-with-last-message",
    })
    useWebAppStore.setState({
      sessions: [
        {
          id: "session-with-last-message",
          name: "Reload chat",
          history: [
            {
              role: "user",
              content: "Earlier message",
              timestamp: "2026-05-15T04:00:00.000Z",
            },
            {
              role: "assistant",
              content: "Earlier response",
              timestamp: "2026-05-15T04:00:01.000Z",
              status: "complete",
            },
            {
              role: "user",
              content: "Last message",
              timestamp: "2026-05-15T04:01:00.000Z",
            },
            {
              role: "assistant",
              content: "Last response",
              timestamp: "2026-05-15T04:01:01.000Z",
              status: "complete",
            },
          ],
          startDate: "2026-05-15T04:00:00.000Z",
          endDate: "2026-05-15T04:01:01.000Z",
          repository: null,
          pullRequest: null,
        },
      ],
      activeSessionId: "session-with-last-message",
    })

    await useWebAppStore.getState().hydrateChatSessions("id-token", { force: true })

    expect(useWebAppStore.getState().sessions[0].history.map(message => message.content)).toEqual([
      "Earlier message",
      "Earlier response",
      "Last message",
      "Last response",
    ])
  })

  it("caches the resource catalog until a forced reload", async () => {
    const backend = {
      backendId: "backend-1",
      name: "Dev state",
      bucket: "terraform-state-demo",
      key: "env/dev.tfstate",
      region: "us-east-1",
      createdAt: "2026-05-15T04:00:00.000Z",
      updatedAt: "2026-05-15T04:00:00.000Z",
    }
    resources.listStateBackends.mockResolvedValue([backend])
    resources.listStateBackendResources.mockResolvedValue([
      {
        backendId: "backend-1",
        address: "aws_s3_bucket.logs",
        type: "aws_s3_bucket",
      },
    ])
    resources.listResourceScans.mockResolvedValue([])
    resources.listDriftGuards.mockResolvedValue([])
    resources.listAwsCredentials.mockResolvedValue({ credentials: [], activeCredentialId: "" })

    const first = await useWebAppStore.getState().loadResourceCatalog("id-token")
    const second = await useWebAppStore.getState().loadResourceCatalog("id-token")
    const third = await useWebAppStore.getState().loadResourceCatalog("id-token", { force: true })

    expect(first.backends).toHaveLength(1)
    expect(second.stateResources).toHaveLength(1)
    expect(third.backends).toHaveLength(1)
    expect(resources.listStateBackends).toHaveBeenCalledTimes(2)
    expect(useWebAppStore.getState().resourceCatalogLoadedFor).toBe("id-token")
  })
})
