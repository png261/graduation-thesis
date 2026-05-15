"use client"

import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react"
import { ChatInput } from "./ChatInput"
import { ChatMessages } from "./ChatMessages"
import type { ChatAttachment, ChatSession, Message, MessageSegment, PullRequestInfo, ToolCall, UserHandoff } from "./types"
import { CHAT_AGENTS, findMentionedAgent } from "./agents"

import { AgentCoreClient } from "@/lib/agentcore-client"
import { useAuth } from "react-oidc-context"
import { useDefaultTool } from "@/hooks/useToolRenderer"
import { ToolCallDisplay } from "./ToolCallDisplay"
import { FileSystemPanel } from "@/components/files/FileSystemPanel"
import type { SelectedRepository, SelectedStateBackend } from "@/lib/agentcore-client/types"
import { useWebAppStore } from "@/stores/webAppStore"
import { listStateBackends } from "@/services/resourcesService"
import { CursorDrivenParticleTypography } from "@/components/ui/cursor-driven-particle-typography"
import { ensureToolCallSegment } from "./tool-call-state"
import {
  abortRunningSession,
  hasRunningSessionController,
  isSessionRunning,
  registerRunningSession,
  unregisterRunningSession,
  useRunningSessions,
} from "./running-sessions"
import { hasPendingAssistantResponse } from "./session-status"
import { ArrowDown, ChevronLeft, ChevronRight } from "lucide-react"

function createChatSession(
  repository: SelectedRepository | null = null,
  id: string = crypto.randomUUID(),
  stateBackend: SelectedStateBackend | null = null
): ChatSession {
  const now = new Date().toISOString()
  return {
    id,
    name: "New chat",
    history: [],
    startDate: now,
    endDate: now,
    repository,
    stateBackend,
  }
}

const NO_REPOSITORY_VALUE = "__no_repository__"
const NO_STATE_BACKEND_VALUE = "__no_state_backend__"

type PendingRepositoryAutoSend = {
  id: number
  repository: SelectedRepository
  prompt: string
}

function applyMessageUpdaterToSession(
  session: ChatSession,
  updater: (messages: Message[]) => Message[]
): ChatSession {
  const nextMessages = updater(session.history ?? [])
  return {
    ...session,
    history: nextMessages,
    endDate: nextMessages[nextMessages.length - 1]?.timestamp ?? session.endDate,
  }
}

function stopStalePendingMessages(messages: Message[]): Message[] {
  if (!hasPendingAssistantResponse(messages)) return messages
  const nextMessages = [...messages]
  const last = nextMessages[nextMessages.length - 1]
  nextMessages[nextMessages.length - 1] = {
    ...last,
    content: last.content === "Thinking..." ? "Stopped." : last.content,
    status: "stopped",
  }
  return nextMessages
}

function normalizeStalePendingSessions(sessions: ChatSession[]): ChatSession[] {
  return sessions.map(session => {
    if (hasRunningSessionController(session.id) || !hasPendingAssistantResponse(session.history)) return session
    const history = stopStalePendingMessages(session.history)
    const last = history[history.length - 1]
    return {
      ...session,
      history,
      endDate: last.timestamp ?? session.endDate,
    }
  })
}

function didSessionsChange(prev: ChatSession[], next: ChatSession[]) {
  return prev.some((session, index) => session !== next[index])
}

function errorMessageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message
  }
  return "Unknown error"
}

export default function ChatInterface() {
  const storedSessions = useWebAppStore.getState().sessions
  const storedActiveSessionId = useWebAppStore.getState().activeSessionId
  const initialSessionsRef = useRef<ChatSession[] | null>(null)
  if (!initialSessionsRef.current) {
    initialSessionsRef.current =
      storedSessions.length > 0 ? normalizeStalePendingSessions(storedSessions) : [createChatSession()]
  }
  const initialSessions = initialSessionsRef.current
  const [sessions, setSessions] = useState<ChatSession[]>(() =>
    initialSessions
  )
  const [sessionId, setSessionId] = useState<string>(() =>
    initialSessions.find(session => session.id === storedActiveSessionId)?.id ??
    initialSessions[0]?.id ??
    crypto.randomUUID()
  )
  const initialSession = sessions.find(session => session.id === sessionId) ?? sessions[0]
  const [messages, setMessages] = useState<Message[]>(() => initialSession?.history ?? [])
  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [client, setClient] = useState<AgentCoreClient | null>(null)
  const [repository, setRepository] = useState<SelectedRepository | null>(() => initialSession?.repository ?? null)
  const [stateBackend, setStateBackend] = useState<SelectedStateBackend | null>(() => initialSession?.stateBackend ?? null)
  const [pullRequest, setPullRequest] = useState<PullRequestInfo | null>(() => initialSession?.pullRequest ?? null)
  const [pendingUserHandoff, setPendingUserHandoff] = useState<UserHandoff | null>(() => initialSession?.pendingUserHandoff ?? null)
  const [installedRepositories, setInstalledRepositories] = useState<SelectedRepository[]>([])
  const [selectedInstalledRepository, setSelectedInstalledRepository] = useState("")
  const [stateBackends, setStateBackends] = useState<SelectedStateBackend[]>([])
  const [selectedStateBackendId, setSelectedStateBackendId] = useState(initialSession?.stateBackend?.backendId ?? NO_STATE_BACKEND_VALUE)
  const [isLoadingInstalledRepositories, setIsLoadingInstalledRepositories] = useState(false)
  const [isLoadingStateBackends, setIsLoadingStateBackends] = useState(false)
  const [isSettingUpSession, setIsSettingUpSession] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [stateBackendError, setStateBackendError] = useState<string | null>(null)
  const [isFilesystemOpen, setIsFilesystemOpen] = useState(false)
  const [filesystemPanelWidth, setFilesystemPanelWidth] = useState(560)
  const [isSessionStoreReady, setIsSessionStoreReady] = useState(() => storedSessions.length > 0)
  const runningSessions = useRunningSessions()

  const auth = useAuth()
  const hydrateChatSessions = useWebAppStore(state => state.hydrateChatSessions)
  const persistChatSessions = useWebAppStore(state => state.persistChatSessions)
  const setStoredSessions = useWebAppStore(state => state.setSessions)
  const setStoredActiveSessionId = useWebAppStore(state => state.setActiveSessionId)
  const storedSessionsFromStore = useWebAppStore(state => state.sessions)
  const storedActiveSessionIdFromStore = useWebAppStore(state => state.activeSessionId)
  const repositoryChatRequest = useWebAppStore(state => state.repositoryChatRequest)
  const selectedAgent = CHAT_AGENTS[0]
  const activeSessionRunning = Boolean(runningSessions[sessionId])

  const [showScrollToLatest, setShowScrollToLatest] = useState(false)

  // Refs for manually returning to the latest response without forcing auto-scroll.
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const shouldFollowLatestRef = useRef(true)
  const activeSessionIdRef = useRef(sessionId)
  const hasRequestedChatSessionsRef = useRef(false)
  const handledRepositoryChatRequestRef = useRef(0)
  const handledAutoSendRequestRef = useRef(0)
  const pendingRepositoryAutoSendRef = useRef<PendingRepositoryAutoSend | null>(null)
  const repositorySetupRequestRef = useRef(0)
  const latestPersistedSessionsRef = useRef(
    JSON.stringify({ sessions: storedSessions, activeSessionId: storedActiveSessionId })
  )

  // Register default tool renderer (wildcard "*")
  useDefaultTool(({ name, args, status, progress, result }) => (
    <ToolCallDisplay name={name} args={args} status={status} progress={progress} result={result} />
  ))

  useEffect(() => {
    activeSessionIdRef.current = sessionId
  }, [sessionId])

  const isActiveSession = useCallback((targetSessionId: string) => activeSessionIdRef.current === targetSessionId, [])

  const updateSessionMessages = useCallback((
    targetSessionId: string,
    updater: (messages: Message[]) => Message[]
  ) => {
    if (isActiveSession(targetSessionId)) {
      setMessages(prev => updater(prev))
    }
    setSessions(prev =>
      prev.map(session =>
        session.id === targetSessionId ? applyMessageUpdaterToSession(session, updater) : session
      )
    )
    const storedState = useWebAppStore.getState()
    if (storedState.sessions.some(session => session.id === targetSessionId)) {
      setStoredSessions(
        storedState.sessions.map(session =>
          session.id === targetSessionId ? applyMessageUpdaterToSession(session, updater) : session
        )
      )
    }
  }, [isActiveSession, setStoredSessions])

  const updateSessionState = useCallback((
    targetSessionId: string,
    updater: (session: ChatSession) => ChatSession
  ) => {
    if (isActiveSession(targetSessionId)) {
      const currentSession = sessions.find(session => session.id === targetSessionId)
      if (currentSession) {
        const nextSession = updater(currentSession)
        setRepository(nextSession.repository ?? null)
        setStateBackend(nextSession.stateBackend ?? null)
        setPullRequest(nextSession.pullRequest ?? null)
        setPendingUserHandoff(nextSession.pendingUserHandoff ?? null)
      }
    }
    setSessions(prev =>
      prev.map(session => (session.id === targetSessionId ? updater(session) : session))
    )
  }, [isActiveSession, sessions])

  const stopPendingSession = useCallback((targetSessionId: string) => {
    updateSessionMessages(targetSessionId, prev => {
      const updated = [...prev]
      const last = updated[updated.length - 1]
      if (hasPendingAssistantResponse(updated) && last) {
        updated[updated.length - 1] = {
          ...last,
          content: last.content === "Thinking..." ? "Stopped." : last.content,
          status: "stopped",
        }
      }
      return updated
    })
    unregisterRunningSession(targetSessionId)
  }, [updateSessionMessages])

  // Load agent configuration and create client on mount
  useEffect(() => {
    async function loadConfig() {
      try {
        const response = await fetch("/aws-exports.json")
        if (!response.ok) {
          throw new Error("Failed to load configuration")
        }
        const config = await response.json()

        if (!config.agentRuntimeArn) {
          throw new Error("Agent Runtime ARN not found in configuration")
        }

        const agentClient = new AgentCoreClient({
          runtimeArn: config.agentRuntimeArn,
          region: config.awsRegion || "ap-southeast-1",
        })

        setClient(agentClient)
      } catch (err) {
        const errorMessage = errorMessageFromUnknown(err)
        setError(`Configuration error: ${errorMessage}`)
        console.error("Failed to load agent configuration:", err)
      }
    }

    loadConfig()
  }, [])

  const updateScrollToLatestVisibility = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) {
      setShowScrollToLatest(false)
      return
    }
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    const isNearBottom = distanceFromBottom < 120
    shouldFollowLatestRef.current = isNearBottom
    setShowScrollToLatest(messages.length > 0 && !isNearBottom)
  }, [messages.length])

  const scrollToLatestResponse = useCallback(() => {
    shouldFollowLatestRef.current = true
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
    setShowScrollToLatest(false)
  }, [])

  useEffect(() => {
    if (messages.length === 0) {
      shouldFollowLatestRef.current = true
      setShowScrollToLatest(false)
      return
    }
    if (shouldFollowLatestRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
      setShowScrollToLatest(false)
      return
    }
    updateScrollToLatestVisibility()
  }, [messages, updateScrollToLatestVisibility])

  useEffect(() => {
    if (!sessions.some(session => session.id === sessionId) && sessions[0]) {
      setSessionId(sessions[0].id)
      setMessages(sessions[0].history ?? [])
      setRepository(sessions[0].repository ?? null)
      setStateBackend(sessions[0].stateBackend ?? null)
      setPullRequest(sessions[0].pullRequest ?? null)
      setPendingUserHandoff(sessions[0].pendingUserHandoff ?? null)
    }
  }, [sessionId, sessions])

  useEffect(() => {
    const normalizedSessions = normalizeStalePendingSessions(sessions)
    if (!didSessionsChange(sessions, normalizedSessions)) return
    const activeSession =
      normalizedSessions.find(session => session.id === sessionId) ?? normalizedSessions[0]
    setSessions(normalizedSessions)
    if (activeSession) {
      setMessages(activeSession.history ?? [])
    }
  }, [])

  useEffect(() => {
    const idToken = auth.user?.id_token
    if (!idToken) return
    if (useWebAppStore.getState().chatSessionsLoadedFor === idToken) {
      setIsSessionStoreReady(true)
      return
    }
    if (hasRequestedChatSessionsRef.current) return
    hasRequestedChatSessionsRef.current = true
    let cancelled = false
    setIsSessionStoreReady(false)
    hydrateChatSessions(idToken)
      .then(response => {
        if (cancelled) return
        const loadedSessions = normalizeStalePendingSessions(response.sessions)
        const nextSessions = loadedSessions.length > 0 ? loadedSessions : [createChatSession()]
        const activeSession =
          nextSessions.find(session => session.id === response.activeSessionId) ?? nextSessions[0]
        setSessions(nextSessions)
        setSessionId(activeSession.id)
        setMessages(activeSession.history ?? [])
        setRepository(activeSession.repository ?? null)
        setStateBackend(activeSession.stateBackend ?? null)
        setPullRequest(activeSession.pullRequest ?? null)
        setPendingUserHandoff(activeSession.pendingUserHandoff ?? null)
        latestPersistedSessionsRef.current = JSON.stringify({
          sessions: loadedSessions,
          activeSessionId: activeSession.id,
        })
        setIsSessionStoreReady(true)
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load chat sessions")
          setIsSessionStoreReady(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [auth.user?.id_token, hydrateChatSessions])

  useEffect(() => {
    if (storedSessionsFromStore.length === 0) return

    const hasSameSessionIds =
      sessions.length === storedSessionsFromStore.length &&
      sessions.every(session => storedSessionsFromStore.some(storedSession => storedSession.id === session.id))
    if (hasSameSessionIds && (!storedActiveSessionIdFromStore || storedActiveSessionIdFromStore === sessionId)) return

    const nextSessions = normalizeStalePendingSessions(storedSessionsFromStore)
    const nextSession =
      nextSessions.find(session => session.id === storedActiveSessionIdFromStore) ?? nextSessions[0]
    if (!nextSession) return
    setSessions(nextSessions)
    setSessionId(nextSession.id)
    setMessages(nextSession.history ?? [])
    setRepository(nextSession.repository ?? null)
    setStateBackend(nextSession.stateBackend ?? null)
    setSelectedStateBackendId(nextSession.stateBackend?.backendId ?? NO_STATE_BACKEND_VALUE)
    setPullRequest(nextSession.pullRequest ?? null)
    setPendingUserHandoff(nextSession.pendingUserHandoff ?? null)
    setInput("")
    setError(null)
  }, [sessionId, sessions, storedActiveSessionIdFromStore, storedSessionsFromStore])

  useEffect(() => {
    const storedActiveSession = useWebAppStore.getState().sessions.find(session => session.id === sessionId)
    if (!storedActiveSession) return
    const storedMessages = storedActiveSession.history ?? []
    if (JSON.stringify(storedMessages) !== JSON.stringify(messages)) {
      setMessages(storedMessages)
    }
  }, [runningSessions, sessionId])

  useEffect(() => {
    if (activeSessionRunning || hasRunningSessionController(sessionId) || !hasPendingAssistantResponse(messages)) return
    const nextMessages = stopStalePendingMessages(messages)
    setMessages(nextMessages)
    setSessions(prev =>
      prev.map(session =>
        session.id === sessionId
          ? {
              ...session,
              history: nextMessages,
              endDate: nextMessages[nextMessages.length - 1]?.timestamp ?? session.endDate,
            }
          : session
      )
    )
    const storedState = useWebAppStore.getState()
    if (storedState.sessions.some(session => session.id === sessionId)) {
      setStoredSessions(
        storedState.sessions.map(session =>
          session.id === sessionId
            ? {
                ...session,
                history: nextMessages,
                endDate: nextMessages[nextMessages.length - 1]?.timestamp ?? session.endDate,
              }
            : session
        )
      )
    }
  }, [activeSessionRunning, messages, sessionId, setStoredSessions])

  useEffect(() => {
    if (!repositoryChatRequest || handledRepositoryChatRequestRef.current === repositoryChatRequest.id) return
    handledRepositoryChatRequestRef.current = repositoryChatRequest.id
    const next = createChatSession(repositoryChatRequest.repository)
    next.name = "Fix Terraform issue"
    activateSession(next)
    setInput(repositoryChatRequest.prompt)
    pendingRepositoryAutoSendRef.current = repositoryChatRequest
  }, [repositoryChatRequest])

  useEffect(() => {
    setStoredSessions(sessions)
    setStoredActiveSessionId(sessionId)
  }, [sessionId, sessions, setStoredActiveSessionId, setStoredSessions])

  useEffect(() => {
    const idToken = auth.user?.id_token
    if (!idToken || !isSessionStoreReady) return
    const persistedSessions = sessions
    const payload = { sessions: persistedSessions, activeSessionId: sessionId }
    const serialized = JSON.stringify(payload)
    if (serialized === latestPersistedSessionsRef.current) return
    const timeout = window.setTimeout(() => {
      persistChatSessions(idToken)
        .then(() => {
          latestPersistedSessionsRef.current = serialized
        })
        .catch(err => {
          setError(err instanceof Error ? err.message : "Failed to save chat sessions")
        })
    }, 900)
    return () => window.clearTimeout(timeout)
  }, [auth.user?.id_token, isSessionStoreReady, persistChatSessions, sessionId, sessions])

  useEffect(() => {
    const lastMessageTimestamp = messages[messages.length - 1]?.timestamp
    setSessions(prev =>
      prev.map(session =>
        session.id === sessionId
          ? {
              ...session,
              history: messages,
              repository,
              stateBackend,
              pullRequest,
              pendingUserHandoff,
              endDate: lastMessageTimestamp ?? session.endDate,
            }
          : session
      )
    )
  }, [messages, pendingUserHandoff, pullRequest, repository, sessionId, stateBackend])

  useEffect(() => {
    const idToken = auth.user?.id_token
    if (!idToken) return
    let cancelled = false
    setIsLoadingStateBackends(true)
    setStateBackendError(null)
    listStateBackends(idToken)
      .then(backends => {
        if (cancelled) return
        setStateBackends(backends)
        setSelectedStateBackendId(current => {
          const sessionBackendId = stateBackend?.backendId
          if (sessionBackendId && backends.some(backend => backend.backendId === sessionBackendId)) return sessionBackendId
          if (current && current !== NO_STATE_BACKEND_VALUE && backends.some(backend => backend.backendId === current)) return current
          return NO_STATE_BACKEND_VALUE
        })
      })
      .catch(err => {
        if (!cancelled) {
          setStateBackendError(err instanceof Error ? err.message : "Failed to load state backends")
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingStateBackends(false)
      })
    return () => {
      cancelled = true
    }
  }, [auth.user?.id_token, stateBackend?.backendId])

  useEffect(() => {
    if (!client || !auth.user?.access_token || repository) return
    let cancelled = false
    setIsLoadingInstalledRepositories(true)
    setSetupError(null)
    client.githubAction(
      "listInstalledRepositories",
      crypto.randomUUID(),
      auth.user.access_token,
      null
    )
      .then(response => {
        if (cancelled) return
        const repositories = ((response as any)?.repositories ?? []) as SelectedRepository[]
        setInstalledRepositories(repositories)
        setSelectedInstalledRepository(current => {
          if (current) return current
          return NO_REPOSITORY_VALUE
        })
      })
      .catch(err => {
        if (!cancelled) {
          setSetupError(err instanceof Error ? err.message : "Failed to load installed repositories")
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingInstalledRepositories(false)
      })
    return () => {
      cancelled = true
    }
  }, [auth.user?.access_token, client, repository])

  const sendMessage = async (userMessage: string, messageAttachments: ChatAttachment[] = []) => {
    const trimmedMessage = userMessage.trim()
    if ((!trimmedMessage && messageAttachments.length === 0) || !client) return
    const targetSessionId = sessionId
    if (isSessionRunning(targetSessionId)) return

    // Clear any previous errors
    setError(null)
    const mentionedAgent = findMentionedAgent(userMessage)
    const activeAgent = mentionedAgent ?? selectedAgent
    const selectedRepository =
      repository ??
      installedRepositories.find(item => item.fullName === selectedInstalledRepository) ??
      null
    const selectedStateBackend =
      stateBackend ??
      stateBackends.find(item => item.backendId === selectedStateBackendId) ??
      null

    // Add user message to chat
    const newUserMessage: Message = {
      role: "user",
      content: trimmedMessage || `Attached ${messageAttachments.length} file${messageAttachments.length === 1 ? "" : "s"}`,
      timestamp: new Date().toISOString(),
      agent: activeAgent,
      attachments: messageAttachments,
    }

    if (!repository && selectedRepository) {
      if (isActiveSession(targetSessionId)) setRepository(selectedRepository)
      setSessions(prev =>
        prev.map(session =>
          session.id === targetSessionId
            ? {
                ...session,
                repository: selectedRepository,
                endDate: newUserMessage.timestamp,
              }
            : session
        )
      )
    }
    if (!stateBackend && selectedStateBackend) {
      if (isActiveSession(targetSessionId)) setStateBackend(selectedStateBackend)
      setSessions(prev =>
        prev.map(session =>
          session.id === targetSessionId
            ? {
                ...session,
                stateBackend: selectedStateBackend,
                endDate: newUserMessage.timestamp,
              }
            : session
        )
      )
    }

    // Create placeholder for assistant response
    const assistantResponse: Message = {
      role: "assistant",
      content: "Thinking...",
      timestamp: new Date().toISOString(),
      status: "pending",
      agent: activeAgent,
    }

    const abortController = new AbortController()
    registerRunningSession(targetSessionId, abortController)
    shouldFollowLatestRef.current = true
    setShowScrollToLatest(false)
    updateSessionMessages(targetSessionId, prev => [...prev, newUserMessage, assistantResponse])
    window.requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
    })
    if (isActiveSession(targetSessionId)) {
      setInput("")
      setAttachments([])
      setPendingUserHandoff(null)
    }

    try {
      // Get auth token from react-oidc-context
      const accessToken = auth.user?.access_token

      if (!accessToken) {
        throw new Error("Authentication required. Please log in again.")
      }

      const segments: MessageSegment[] = []
      const toolCallMap = new Map<string, ToolCall>()

      const updateMessage = () => {
        // Build content from text segments for backward compat
        const content = segments
          .filter((s): s is Extract<MessageSegment, { type: "text" }> => s.type === "text")
          .map(s => s.content)
          .join("")

        updateSessionMessages(targetSessionId, prev => {
          const updated = [...prev]
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content: content || "Thinking...",
            status: "pending",
            segments: [...segments],
          }
          return updated
        })
      }

      // User identity is extracted server-side from the validated JWT token,
      // not passed as a parameter — prevents impersonation via prompt injection.
      await client.invoke(trimmedMessage || "Please review the attached file(s).", targetSessionId, accessToken, event => {
        switch (event.type) {
          case "agent": {
            updateSessionMessages(targetSessionId, prev => {
              const updated = [...prev]
              const last = updated[updated.length - 1]
              if (last?.role === "assistant") {
                updated[updated.length - 1] = { ...last, agent: event.agent }
              }
              return updated
            })
            break
          }
          case "text": {
            // If text arrives after a tool segment, mark all pending tools as complete
            const prev = segments[segments.length - 1]
            if (prev && prev.type === "tool") {
              for (const tc of toolCallMap.values()) {
                if (tc.status === "streaming" || tc.status === "executing") {
                  tc.status = "complete"
                }
              }
            }
            // Append to last text segment, or create new one
            const last = segments[segments.length - 1]
            if (last && last.type === "text") {
              last.content += event.content
            } else {
              segments.push({ type: "text", content: event.content })
            }
            updateMessage()
            break
          }
          case "tool_use_start": {
            ensureToolCallSegment(segments, toolCallMap, event)
            updateMessage()
            break
          }
          case "tool_use_delta": {
            const tc = toolCallMap.get(event.toolUseId)
            if (tc) {
              tc.input += event.input
            }
            updateMessage()
            break
          }
          case "tool_use_input_snapshot": {
            const tc = toolCallMap.get(event.toolUseId)
            if (tc) {
              tc.input = event.input
            }
            updateMessage()
            break
          }
          case "tool_progress": {
            const tc = toolCallMap.get(event.toolUseId)
            if (tc) {
              tc.status = "executing"
              const progress = tc.progress ?? []
              const last = progress[progress.length - 1]
              const lastPhase = typeof last === "string" ? "" : last?.phase
              const lastMessage = typeof last === "string" ? last : last?.message
              if (lastPhase !== event.phase || lastMessage !== event.message) {
                tc.progress = [...progress.slice(-49), { phase: event.phase, message: event.message }]
              }
            }
            updateMessage()
            break
          }
          case "tool_result": {
            const tc = toolCallMap.get(event.toolUseId)
            if (tc) {
              tc.result = event.result
              tc.status = "complete"
            }
            updateMessage()
            break
          }
          case "message": {
            if (event.role === "assistant") {
              for (const tc of toolCallMap.values()) {
                if (tc.status === "streaming") tc.status = "executing"
              }
              updateMessage()
            }
            break
          }
          case "pull_request": {
            const nextPullRequest = event.pullRequest as PullRequestInfo
            updateSessionState(targetSessionId, session => ({ ...session, pullRequest: nextPullRequest }))
            break
          }
          case "session_title": {
            const title = event.title.trim()
            if (title) {
              setSessions(prev =>
                prev.map(session =>
                  session.id === targetSessionId
                    ? {
                        ...session,
                        name: title.slice(0, 80),
                        endDate: new Date().toISOString(),
                      }
                    : session
                )
              )
            }
            break
          }
          case "user_handoff": {
            updateSessionState(targetSessionId, session => ({
              ...session,
              pendingUserHandoff: event.handoff as UserHandoff,
            }))
            break
          }
        }
      }, selectedRepository, activeAgent, messageAttachments, selectedStateBackend, abortController.signal)
      updateSessionMessages(targetSessionId, prev => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last?.role === "assistant") {
          const hasTextSegment = last.segments?.some(segment => segment.type === "text" && segment.content.trim())
          updated[updated.length - 1] = {
            ...last,
            content:
              last.content === "Thinking..." && !hasTextSegment
                ? "The configured model returned an empty response."
                : last.content,
            status: "complete",
          }
        }
        return updated
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError" && abortController.signal.aborted) {
        stopPendingSession(targetSessionId)
        return
      }
      const errorMessage = errorMessageFromUnknown(err)
      if (isActiveSession(targetSessionId)) setError(`Failed to get response: ${errorMessage}`)
      console.error("Error invoking AgentCore:", err)

      // Update the assistant message with error
      updateSessionMessages(targetSessionId, prev => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          content: `I encountered an error processing your request: ${errorMessage}`,
          status: "error",
        }
        return updated
      })
    } finally {
      unregisterRunningSession(targetSessionId)
    }
  }

  const stopMessage = useCallback(() => {
    if (!abortRunningSession(sessionId)) {
      stopPendingSession(sessionId)
    }
  }, [sessionId, stopPendingSession])

  useEffect(() => {
    if (!client || !pendingRepositoryAutoSendRef.current) return
    void startRepositoryAutoSend(pendingRepositoryAutoSendRef.current)
  }, [client, sessionId])

  async function startRepositoryAutoSend(request: PendingRepositoryAutoSend) {
    if (handledAutoSendRequestRef.current === request.id || !client || !auth.user?.access_token || isSessionRunning(sessionId)) return
    handledAutoSendRequestRef.current = request.id
    pendingRepositoryAutoSendRef.current = null
    setInput("")
    setIsSettingUpSession(true)
    try {
      await client.githubAction("setupRepositoryWorkspace", sessionId, auth.user.access_token, request.repository)
      await sendMessage(request.prompt, [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start fix chat")
    } finally {
      setIsSettingUpSession(false)
    }
  }

  // Handle form submission
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()

    sendMessage(input, attachments)
  }

  const activateSession = (next: ChatSession) => {
    const nextSessions = [
      next,
      ...sessions.filter(session => session.id !== next.id),
    ]
    setStoredSessions(nextSessions)
    setStoredActiveSessionId(next.id)
    setSessions(nextSessions)
    setSessionId(next.id)
    setMessages(next.history ?? [])
    setRepository(next.repository ?? null)
    setStateBackend(next.stateBackend ?? null)
    setSelectedInstalledRepository(next.repository?.fullName ?? NO_REPOSITORY_VALUE)
    setSelectedStateBackendId(next.stateBackend?.backendId ?? NO_STATE_BACKEND_VALUE)
    setPullRequest(next.pullRequest ?? null)
    setPendingUserHandoff(next.pendingUserHandoff ?? null)
    setInput("")
    setError(null)
  }

  const handleUserHandoffSubmit = (answers: string) => {
    setPendingUserHandoff(null)
    void sendMessage(answers, [])
  }

  const setupRepositoryWorkspace = async (requestedRepository: SelectedRepository) => {
    const requestId = repositorySetupRequestRef.current + 1
    repositorySetupRequestRef.current = requestId
    setIsSettingUpSession(true)
    try {
      if (!client) throw new Error("Agent runtime is not configured yet")
      const accessToken = auth.user?.access_token
      if (!accessToken) throw new Error("Authentication required. Please log in again.")
      await client.githubAction("setupRepositoryWorkspace", sessionId, accessToken, requestedRepository)
      if (repositorySetupRequestRef.current !== requestId) return
      setRepository(requestedRepository)
      setSessions(prev =>
        prev.map(session =>
          session.id === sessionId
            ? {
                ...session,
                repository: requestedRepository,
                endDate: new Date().toISOString(),
              }
            : session
        )
      )
      setSelectedInstalledRepository(requestedRepository.fullName)
    } catch (err) {
      if (repositorySetupRequestRef.current === requestId) {
        setSetupError(err instanceof Error ? err.message : "Failed to clone GitHub repository")
      }
    } finally {
      if (repositorySetupRequestRef.current === requestId) {
        setIsSettingUpSession(false)
      }
    }
  }

  const setupRepositoryWorkspaceForSelection = async (value: string) => {
    if (isRepositoryLocked) return
    setSelectedInstalledRepository(value)
    setSetupError(null)

    if (value === NO_REPOSITORY_VALUE) {
      repositorySetupRequestRef.current += 1
      setRepository(null)
      return
    }

    const requestedRepository = installedRepositories.find(item => item.fullName === value)
    if (!requestedRepository) return
    await setupRepositoryWorkspace(requestedRepository)
  }

  const selectStateBackend = async (backendId: string) => {
    setSelectedStateBackendId(backendId)
    setStateBackendError(null)

    if (backendId === NO_STATE_BACKEND_VALUE) {
      setStateBackend(null)
      setSessions(prev =>
        prev.map(session =>
          session.id === sessionId
            ? {
                ...session,
                stateBackend: null,
                endDate: new Date().toISOString(),
              }
            : session
        )
      )
      return
    }

    const nextStateBackend = stateBackends.find(item => item.backendId === backendId)
    if (!nextStateBackend) return
    setStateBackend(nextStateBackend)
    setSessions(prev =>
      prev.map(session =>
        session.id === sessionId
          ? {
              ...session,
              stateBackend: nextStateBackend,
              endDate: new Date().toISOString(),
            }
          : session
      )
    )

    if (!repository && !isRepositoryLocked && nextStateBackend.repository) {
      await setupRepositoryWorkspace(nextStateBackend.repository)
    }
  }

  // Check if this is the initial state (no messages)
  const isInitialState = messages.length === 0
  const selectedStateBackendValue = stateBackend?.backendId || selectedStateBackendId || NO_STATE_BACKEND_VALUE
  const hasSelectedStateBackend = selectedStateBackendValue !== NO_STATE_BACKEND_VALUE
  const isRepositoryLocked = hasSelectedStateBackend || (Boolean(repository) && (messages.length > 0 || activeSessionRunning))
  const selectedRepositoryFullName = repository?.fullName || selectedInstalledRepository || NO_REPOSITORY_VALUE
  const showFilesystem = Boolean(repository && isFilesystemOpen)
  const handleFilesystemResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const move = (moveEvent: PointerEvent) => {
      const maxWidth = Math.max(420, Math.min(window.innerWidth - 420, Math.round(window.innerWidth * 0.72)))
      const nextWidth = window.innerWidth - moveEvent.clientX
      setFilesystemPanelWidth(Math.min(maxWidth, Math.max(420, nextWidth)))
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }, [])

  return (
    <div
      className="relative grid h-full w-full grid-cols-1 overflow-hidden bg-white transition-[grid-template-columns] duration-300 lg:grid-cols-[var(--chat-layout-columns)]"
      style={{
        ["--chat-layout-columns" as string]: showFilesystem
          ? `minmax(360px,1fr) 6px minmax(420px,${filesystemPanelWidth}px)`
          : "minmax(0,1fr) 0px minmax(0,0px)",
      }}
    >
      <section className="flex min-h-0 min-w-0 flex-col bg-white text-slate-950">
      <div className="flex-none bg-white">
        {pullRequest?.number && (
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
            <span className="rounded-full border border-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
              PR #{pullRequest.number}
            </span>
          </div>
        )}
        {error && (
          <div className="mx-4 mt-2 border-l-4 border-red-500 bg-red-50 p-4">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
      </div>

      {/* Conditional layout based on whether there are messages */}
      {isInitialState ? (
        // Initial state
        <>
          {/* Empty space above */}
          <div className="grow" />

          {/* Centered welcome message */}
          <div className="mx-auto mb-24 flex w-full max-w-5xl flex-col items-center gap-3 px-4 text-center">
            <div className="relative h-44 w-full max-w-5xl text-slate-950 sm:h-52">
              <CursorDrivenParticleTypography
                text="InfraQ"
                className="relative h-full min-h-0 text-slate-950"
                fontSize={132}
                particleSize={1.8}
                particleDensity={4}
              />
            </div>
          </div>

          {/* Empty space below */}
          <div className="grow" />
        </>
      ) : (
        // Chat in progress - normal layout
        <>
          {/* Scrollable message area */}
          <div className="grow overflow-hidden">
            <div className="max-w-4xl mx-auto w-full h-full">
              <ChatMessages
                messages={messages}
                messagesContainerRef={messagesContainerRef}
                messagesEndRef={messagesEndRef}
                onScroll={updateScrollToLatestVisibility}
              />
            </div>
          </div>
        </>
      )}
      </section>
      {showScrollToLatest && (
        <button
          type="button"
          onClick={scrollToLatestResponse}
          className="absolute bottom-32 left-1/2 z-50 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-lg transition-colors hover:bg-slate-50"
          aria-label="Scroll to latest response"
        >
          <ArrowDown className="h-4 w-4" />
          <span>Latest response</span>
        </button>
      )}
      {repository && (
        <button
          type="button"
          className={`absolute top-1/2 z-50 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition-[right,background-color] hover:bg-slate-50 lg:flex ${isFilesystemOpen ? "" : "right-3"}`}
          style={isFilesystemOpen ? { right: `${filesystemPanelWidth + 12}px` } : undefined}
          onClick={() => setIsFilesystemOpen(open => !open)}
          aria-label={isFilesystemOpen ? "Collapse filesystem" : "Open filesystem"}
          title={isFilesystemOpen ? "Collapse filesystem" : "Open filesystem"}
        >
          {isFilesystemOpen ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      )}
      <div
        aria-orientation="vertical"
        className={showFilesystem ? "hidden cursor-col-resize bg-slate-200 transition hover:bg-slate-300 lg:block" : "hidden"}
        onPointerDown={handleFilesystemResize}
        role="separator"
      />
      <div className="absolute bottom-4 left-1/2 z-40 w-full max-w-5xl -translate-x-1/2 px-4">
        <ChatInput
          input={input}
          setInput={setInput}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          handleSubmit={handleSubmit}
          isLoading={activeSessionRunning}
          onStop={stopMessage}
          className="bg-transparent p-0"
          agents={CHAT_AGENTS}
          repositories={installedRepositories}
          selectedRepositoryFullName={selectedRepositoryFullName}
          onRepositoryChange={value => void setupRepositoryWorkspaceForSelection(value)}
          repositoryLocked={isRepositoryLocked}
          isLoadingRepositories={isLoadingInstalledRepositories || isSettingUpSession}
          repositoryError={setupError}
          stateBackends={stateBackends}
          selectedStateBackendId={selectedStateBackendValue}
          onStateBackendChange={value => void selectStateBackend(value)}
          isLoadingStateBackends={isLoadingStateBackends}
          stateBackendError={stateBackendError}
          userHandoff={pendingUserHandoff}
          onUserHandoffSubmit={handleUserHandoffSubmit}
        />
      </div>
      <div className="hidden min-h-0 min-w-0 overflow-hidden border-l border-slate-200 bg-white lg:block">
        {repository && isFilesystemOpen && (
          <FileSystemPanel
            accessToken={auth.user?.access_token ?? null}
            client={client}
            repository={repository}
            stateBackend={stateBackend}
            sessionId={sessionId}
          />
        )}
      </div>
    </div>
  )
}
