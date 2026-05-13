import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import type { ChatAgent, ChatSession } from "@/components/chat/types"
import type { SelectedRepository } from "@/lib/agentcore-client/types"
import {
  getUserConfig,
  GitHubPullRequestStatus,
  deleteChatSession,
  listChatSessions,
  listGitHubPullRequests,
  saveChatSessions,
  saveUserConfig,
} from "@/services/resourcesService"

type PullRequestState = "open" | "closed" | "merged" | "all"

type PullRequestCacheEntry = {
  items: GitHubPullRequestStatus[]
  fetchedAt: number
}

type ChatSessionsPayload = {
  sessions: ChatSession[]
  activeSessionId?: string
}

type RepositoryChatRequest = {
  id: number
  repository: SelectedRepository
  prompt: string
}

type WebAppStore = {
  sessions: ChatSession[]
  activeSessionId: string
  newChatRequestId: number
  repositoryChatRequest: RepositoryChatRequest | null
  selectedAgentId: ChatAgent["id"]
  chatSessionsLoadedFor: string
  selectedRepository: SelectedRepository | null
  userConfigLoadedFor: string
  pullRequestsByKey: Record<string, PullRequestCacheEntry>
  setSessions: (sessions: ChatSession[]) => void
  setActiveSessionId: (activeSessionId: string) => void
  requestNewChat: () => void
  setSelectedAgentId: (selectedAgentId: ChatAgent["id"]) => void
  requestRepositoryChat: (repository: SelectedRepository, prompt: string) => void
  upsertSession: (session: ChatSession) => void
  deleteSession: (sessionId: string) => void
  deleteChatSession: (sessionId: string, idToken: string) => Promise<ChatSessionsPayload>
  hydrateChatSessions: (idToken: string, options?: { force?: boolean }) => Promise<ChatSessionsPayload>
  persistChatSessions: (idToken: string) => Promise<ChatSessionsPayload>
  setSelectedRepository: (repository: SelectedRepository | null) => void
  hydrateUserConfig: (idToken: string, options?: { force?: boolean }) => Promise<void>
  persistSelectedRepository: (repository: SelectedRepository, idToken: string) => Promise<void>
  pullRequestCacheKey: (repository: string, state: PullRequestState) => string
  loadPullRequests: (
    repository: string,
    state: PullRequestState,
    idToken: string,
    options?: { force?: boolean }
  ) => Promise<GitHubPullRequestStatus[]>
}

const cacheKey = (repository: string, state: PullRequestState) => `${repository}::${state}`

function createEmptyChatSession(): ChatSession {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    name: "New chat",
    history: [],
    startDate: now,
    endDate: now,
    repository: null,
    pullRequest: null,
  }
}

function isEmptyNewChatSession(session: ChatSession): boolean {
  return !session.repository && !session.pullRequest && (session.history?.length ?? 0) === 0
}

function mergeSavedSessions(localSessions: ChatSession[], savedSessions: ChatSession[]): ChatSession[] {
  const savedSessionIds = new Set(savedSessions.map(session => session.id))
  return [
    ...localSessions.filter(session => !savedSessionIds.has(session.id)),
    ...savedSessions,
  ]
}

function resolveActiveSessionId(
  sessions: ChatSession[],
  preferredActiveSessionId?: string,
  fallbackActiveSessionId?: string
): string {
  return (
    sessions.find(session => session.id === preferredActiveSessionId)?.id ??
    sessions.find(session => session.id === fallbackActiveSessionId)?.id ??
    sessions[0]?.id ??
    ""
  )
}

export const useWebAppStore = create<WebAppStore>()(
  persist(
    (set, get) => ({
      sessions: [],
      activeSessionId: "",
      newChatRequestId: 0,
      repositoryChatRequest: null,
      selectedAgentId: "agent1",
      chatSessionsLoadedFor: "",
      selectedRepository: null,
      userConfigLoadedFor: "",
      pullRequestsByKey: {},
      setSessions: sessions => set({ sessions }),
      setActiveSessionId: activeSessionId => set({ activeSessionId }),
      setSelectedAgentId: selectedAgentId => set({ selectedAgentId }),
      requestNewChat: () =>
        set(state => {
          const existingEmptySession = state.sessions.find(isEmptyNewChatSession)
          const nextSession = existingEmptySession ?? createEmptyChatSession()
          return {
            sessions: [
              nextSession,
              ...state.sessions.filter(session => session.id !== nextSession.id),
            ],
            activeSessionId: nextSession.id,
            newChatRequestId: Date.now(),
          }
        }),
      requestRepositoryChat: (repository, prompt) =>
        set({ repositoryChatRequest: { id: Date.now(), repository, prompt } }),
      upsertSession: session =>
        set(state => ({
          sessions: [
            session,
            ...state.sessions.filter(item => item.id !== session.id),
          ],
          activeSessionId: session.id,
        })),
      deleteSession: sessionId =>
        set(state => ({
          sessions: state.sessions.filter(session => session.id !== sessionId),
          activeSessionId:
            state.activeSessionId === sessionId
              ? state.sessions.find(session => session.id !== sessionId)?.id ?? ""
              : state.activeSessionId,
        })),
      deleteChatSession: async (sessionId, idToken) => {
        const state = get()
        const remainingSessions = state.sessions.filter(session => session.id !== sessionId)
        const nextActiveSessionId =
          state.activeSessionId === sessionId
            ? remainingSessions[0]?.id ?? ""
            : state.activeSessionId
        set({
          sessions: remainingSessions,
          activeSessionId: nextActiveSessionId,
        })
        const response = await deleteChatSession(sessionId, idToken)
        const sessions = response.sessions
        set({
          sessions,
          activeSessionId: response.activeSessionId || nextActiveSessionId,
          chatSessionsLoadedFor: idToken,
        })
        return response
      },
      hydrateChatSessions: async (idToken, options = {}) => {
        const state = get()
        if (!options.force && state.chatSessionsLoadedFor === idToken) {
          return { sessions: state.sessions, activeSessionId: state.activeSessionId }
        }

        const response = await listChatSessions(idToken)
        const sessions = response.sessions.length > 0 ? response.sessions : [createEmptyChatSession()]
        const activeSessionId =
          sessions.find(session => session.id === response.activeSessionId)?.id ?? sessions[0]?.id ?? ""
        set({ sessions, activeSessionId, chatSessionsLoadedFor: idToken })
        return { sessions, activeSessionId }
      },
      persistChatSessions: async idToken => {
        const state = get()
        const payload = {
          sessions: state.sessions,
          activeSessionId: state.activeSessionId,
        }
        const response = await saveChatSessions(payload, idToken)
        const latestState = get()
        const sessions = mergeSavedSessions(latestState.sessions, response.sessions)
        const activeSessionId = resolveActiveSessionId(
          sessions,
          latestState.activeSessionId,
          response.activeSessionId || payload.activeSessionId
        )
        set({
          sessions,
          activeSessionId,
          chatSessionsLoadedFor: idToken,
        })
        return { sessions, activeSessionId }
      },
      setSelectedRepository: repository => set({ selectedRepository: repository }),
      hydrateUserConfig: async (idToken, options = {}) => {
        if (!options.force && get().userConfigLoadedFor === idToken) return
        const config = await getUserConfig(idToken)
        const selected = config.selectedRepository
        set({
          selectedRepository:
            selected && typeof selected === "object" && "fullName" in selected
              ? (selected as SelectedRepository)
              : get().selectedRepository,
          userConfigLoadedFor: idToken,
        })
      },
      persistSelectedRepository: async (repository, idToken) => {
        set({ selectedRepository: repository, userConfigLoadedFor: idToken })
        await saveUserConfig("selectedRepository", repository, idToken)
      },
      pullRequestCacheKey: cacheKey,
      loadPullRequests: async (repository, state, idToken, options = {}) => {
        const key = cacheKey(repository, state)
        const cached = get().pullRequestsByKey[key]
        if (!options.force && cached) return cached.items

        const items = await listGitHubPullRequests(repository, state, idToken)
        set(current => ({
          pullRequestsByKey: {
            ...current.pullRequestsByKey,
            [key]: { items, fetchedAt: Date.now() },
          },
        }))
        return items
      },
    }),
    {
      name: "agentcore:web-app-store",
      storage: createJSONStorage(() => localStorage),
      partialize: state => ({
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
        selectedAgentId: state.selectedAgentId,
        selectedRepository: state.selectedRepository,
        pullRequestsByKey: state.pullRequestsByKey,
      }),
    }
  )
)
