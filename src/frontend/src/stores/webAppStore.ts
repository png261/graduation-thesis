import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import type { ChatSession, Message } from "@/components/chat/types"
import type { SelectedRepository } from "@/lib/agentcore-client/types"
import {
  AwsCredentialMetadata,
  DriftGuard,
  getUserConfig,
  GitHubPullRequestStatus,
  ResourceScan,
  StateBackend,
  StateBackendResource,
  deleteChatSession,
  listChatSessions,
  listAwsCredentials,
  listDriftGuards,
  listGitHubPullRequests,
  listResourceScans,
  listStateBackendResources,
  listStateBackends,
  saveChatSessions,
  saveUserConfig,
} from "@/services/resourcesService"

type PullRequestState = "open" | "closed" | "merged" | "all"

type PullRequestCacheEntry = {
  items: GitHubPullRequestStatus[]
  fetchedAt: number
}

type ResourceCatalogData = {
  backends: StateBackend[]
  stateResources: StateBackendResource[]
  scans: ResourceScan[]
  guards: DriftGuard[]
  credentials: AwsCredentialMetadata[]
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
  chatSessionsLoadedFor: string
  selectedRepository: SelectedRepository | null
  userConfigLoadedFor: string
  pullRequestsByKey: Record<string, PullRequestCacheEntry>
  resourceCatalog: ResourceCatalogData
  resourceCatalogLoadedFor: string
  resourceCatalogFetchedAt: number
  isResourceCatalogLoading: boolean
  setSessions: (sessions: ChatSession[]) => void
  setActiveSessionId: (activeSessionId: string) => void
  requestNewChat: () => void
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
  setResourceCatalog: (
    updater: ResourceCatalogData | ((current: ResourceCatalogData) => ResourceCatalogData),
    idToken?: string
  ) => void
  loadResourceCatalog: (idToken: string, options?: { force?: boolean }) => Promise<ResourceCatalogData>
}

const cacheKey = (repository: string, state: PullRequestState) => `${repository}::${state}`
const MAX_PERSISTED_ATTACHMENT_DATA_URL_BYTES = 512 * 1024

const emptyResourceCatalog = (): ResourceCatalogData => ({
  backends: [],
  stateResources: [],
  scans: [],
  guards: [],
  credentials: [],
})

function createEmptyChatSession(): ChatSession {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    name: "New chat",
    history: [],
    startDate: now,
    endDate: now,
    repository: null,
    stateBackend: null,
    pullRequest: null,
  }
}

function isEmptyNewChatSession(session: ChatSession): boolean {
  return !session.repository && !session.stateBackend && !session.pullRequest && (session.history?.length ?? 0) === 0
}

function messageKey(message: Message): string {
  return `${message.role}\u0000${message.timestamp}\u0000${message.content}`
}

function hasUsableAttachmentData(message: Message): boolean {
  return Boolean(message.attachments?.some(attachment => attachment.dataUrl))
}

function stripLargeAttachmentPayloads(message: Message): Message {
  if (!message.attachments?.length) return message
  return {
    ...message,
    attachments: message.attachments.map(attachment => {
      if (
        !attachment.dataUrl ||
        new Blob([attachment.dataUrl]).size <= MAX_PERSISTED_ATTACHMENT_DATA_URL_BYTES
      ) {
        return attachment
      }
      const { dataUrl: _dataUrl, ...metadata } = attachment
      return metadata
    }),
  }
}

function sanitizeSessionsForPersistence(sessions: ChatSession[]): ChatSession[] {
  return sessions.map(session => ({
    ...session,
    history: (session.history ?? []).map(stripLargeAttachmentPayloads),
  }))
}

function mergeSavedHistory(savedHistory: Message[] = [], localHistory: Message[] = []): Message[] {
  const localMessagesByKey = new Map(localHistory.map(message => [messageKey(message), message]))
  const savedMessageKeys = new Set(savedHistory.map(messageKey))
  const mergedHistory = savedHistory.map(message => {
    if (hasUsableAttachmentData(message)) return message
    const localMessage = localMessagesByKey.get(messageKey(message))
    if (!localMessage?.attachments?.length) return message
    return {
      ...message,
      attachments: localMessage.attachments,
    }
  })
  return [
    ...mergedHistory,
    ...localHistory.filter(message => !savedMessageKeys.has(messageKey(message))),
  ]
}

function mergeSavedSession(localSession: ChatSession | undefined, savedSession: ChatSession): ChatSession {
  if (!localSession) return savedSession
  return {
    ...savedSession,
    history: mergeSavedHistory(savedSession.history, localSession.history),
  }
}

function mergeSavedSessions(localSessions: ChatSession[], savedSessions: ChatSession[]): ChatSession[] {
  const localSessionsById = new Map(localSessions.map(session => [session.id, session]))
  const savedSessionIds = new Set(savedSessions.map(session => session.id))
  return [
    ...localSessions.filter(session => !savedSessionIds.has(session.id)),
    ...savedSessions.map(session => mergeSavedSession(localSessionsById.get(session.id), session)),
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
      chatSessionsLoadedFor: "",
      selectedRepository: null,
      userConfigLoadedFor: "",
      pullRequestsByKey: {},
      resourceCatalog: emptyResourceCatalog(),
      resourceCatalogLoadedFor: "",
      resourceCatalogFetchedAt: 0,
      isResourceCatalogLoading: false,
      setSessions: sessions => set({ sessions }),
      setActiveSessionId: activeSessionId => set({ activeSessionId }),
      requestNewChat: () =>
        set(state => {
          const nextSession = createEmptyChatSession()
          return {
            sessions: [
              nextSession,
              ...state.sessions,
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
        const savedSessions = response.sessions.length > 0 ? response.sessions : [createEmptyChatSession()]
        const latestState = get()
        const localSessions = latestState.sessions.filter(session => !isEmptyNewChatSession(session))
        const sessions = mergeSavedSessions(localSessions, savedSessions)
        const activeSessionId = resolveActiveSessionId(
          sessions,
          latestState.activeSessionId,
          response.activeSessionId
        )
        set({ sessions, activeSessionId, chatSessionsLoadedFor: idToken })
        return { sessions, activeSessionId }
      },
      persistChatSessions: async idToken => {
        const state = get()
        const payload = {
          sessions: sanitizeSessionsForPersistence(state.sessions),
          activeSessionId: state.activeSessionId,
        }
        const serializedPayload = JSON.stringify(payload)
        const response = await saveChatSessions(payload, idToken)
        const latestState = get()
        const latestPayload = {
          sessions: latestState.sessions,
          activeSessionId: latestState.activeSessionId,
        }
        if (JSON.stringify(latestPayload) !== serializedPayload) {
          set({ chatSessionsLoadedFor: idToken })
          return latestPayload
        }
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
      setResourceCatalog: (updater, idToken) =>
        set(state => ({
          resourceCatalog: typeof updater === "function" ? updater(state.resourceCatalog) : updater,
          resourceCatalogLoadedFor: idToken ?? state.resourceCatalogLoadedFor,
          resourceCatalogFetchedAt: Date.now(),
        })),
      loadResourceCatalog: async (idToken, options = {}) => {
        const state = get()
        if (!options.force && state.resourceCatalogLoadedFor === idToken) {
          return state.resourceCatalog
        }

        set({ isResourceCatalogLoading: true })
        try {
          const [backends, scans, guards, credentialsResponse] = await Promise.all([
            listStateBackends(idToken),
            listResourceScans(idToken),
            listDriftGuards(idToken),
            listAwsCredentials(idToken).catch(() => ({ credentials: [], activeCredentialId: "" })),
          ])
          const stateResources = (
            await Promise.all(
              backends.map(backend =>
                listStateBackendResources(backend.backendId, idToken).catch(() => [] as StateBackendResource[])
              )
            )
          ).flat()
          const resourceCatalog = {
            backends,
            stateResources,
            scans,
            guards,
            credentials: credentialsResponse.credentials,
          }
          set({
            resourceCatalog,
            resourceCatalogLoadedFor: idToken,
            resourceCatalogFetchedAt: Date.now(),
            isResourceCatalogLoading: false,
          })
          return resourceCatalog
        } catch (error) {
          set({ isResourceCatalogLoading: false })
          throw error
        }
      },
    }),
    {
      name: "agentcore:web-app-store",
      storage: createJSONStorage(() => localStorage),
      partialize: state => ({
        sessions: sanitizeSessionsForPersistence(state.sessions),
        activeSessionId: state.activeSessionId,
        selectedRepository: state.selectedRepository,
        pullRequestsByKey: state.pullRequestsByKey,
      }),
    }
  )
)
