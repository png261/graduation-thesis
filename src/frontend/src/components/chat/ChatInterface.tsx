"use client"

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { ChatInput } from "./ChatInput"
import { ChatMessages } from "./ChatMessages"
import type { ChatAttachment, ChatSession, Message, MessageSegment, PullRequestInfo, ToolCall, UserHandoff } from "./types"
import { CHAT_AGENTS, findMentionedAgent } from "./agents"

import { useGlobal } from "@/app/context/GlobalContext"
import { AgentCoreClient } from "@/lib/agentcore-client"
import { useAuth } from "react-oidc-context"
import { useDefaultTool } from "@/hooks/useToolRenderer"
import { ToolCallDisplay } from "./ToolCallDisplay"
import { FileSystemPanel } from "@/components/files/FileSystemPanel"
import type { SelectedRepository } from "@/lib/agentcore-client/types"
import { useWebAppStore } from "@/stores/webAppStore"
import { Button } from "@/components/ui/button"
import { CursorDrivenParticleTypography } from "@/components/ui/cursor-driven-particle-typography"
import { ensureToolCallSegment } from "./tool-call-state"
import { ChevronLeft, ChevronRight } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

function createChatSession(repository: SelectedRepository | null = null, id: string = crypto.randomUUID()): ChatSession {
  const now = new Date().toISOString()
  return {
    id,
    name: "New chat",
    history: [],
    startDate: now,
    endDate: now,
    repository,
  }
}

const NO_REPOSITORY_VALUE = "__no_repository__"

export default function ChatInterface() {
  const storedSessions = useWebAppStore.getState().sessions
  const storedActiveSessionId = useWebAppStore.getState().activeSessionId
  const [sessions, setSessions] = useState<ChatSession[]>(() =>
    storedSessions.length > 0 ? storedSessions : [createChatSession()]
  )
  const [sessionId, setSessionId] = useState<string>(() =>
    storedSessions.find(session => session.id === storedActiveSessionId)?.id ??
    storedSessions[0]?.id ??
    crypto.randomUUID()
  )
  const initialSession = sessions.find(session => session.id === sessionId) ?? sessions[0]
  const [messages, setMessages] = useState<Message[]>(() => initialSession?.history ?? [])
  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [client, setClient] = useState<AgentCoreClient | null>(null)
  const [repository, setRepository] = useState<SelectedRepository | null>(() => initialSession?.repository ?? null)
  const [pullRequest, setPullRequest] = useState<PullRequestInfo | null>(() => initialSession?.pullRequest ?? null)
  const [pendingUserHandoff, setPendingUserHandoff] = useState<UserHandoff | null>(() => initialSession?.pendingUserHandoff ?? null)
  const [isSetupOpen, setIsSetupOpen] = useState(false)
  const [installedRepositories, setInstalledRepositories] = useState<SelectedRepository[]>([])
  const [selectedInstalledRepository, setSelectedInstalledRepository] = useState("")
  const [isLoadingInstalledRepositories, setIsLoadingInstalledRepositories] = useState(false)
  const [isSettingUpSession, setIsSettingUpSession] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [isFilesystemOpen, setIsFilesystemOpen] = useState(false)
  const [isSessionStoreReady, setIsSessionStoreReady] = useState(() => storedSessions.length > 0)

  const { isLoading, setIsLoading } = useGlobal()
  const auth = useAuth()
  const hydrateChatSessions = useWebAppStore(state => state.hydrateChatSessions)
  const persistChatSessions = useWebAppStore(state => state.persistChatSessions)
  const setStoredSessions = useWebAppStore(state => state.setSessions)
  const setStoredActiveSessionId = useWebAppStore(state => state.setActiveSessionId)
  const storedSessionsFromStore = useWebAppStore(state => state.sessions)
  const storedActiveSessionIdFromStore = useWebAppStore(state => state.activeSessionId)
  const repositoryChatRequest = useWebAppStore(state => state.repositoryChatRequest)
  const selectedAgent = CHAT_AGENTS[0]

  // Ref for message container to enable auto-scrolling
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const hasRequestedChatSessionsRef = useRef(false)
  const handledRepositoryChatRequestRef = useRef(0)
  const repositorySetupRequestRef = useRef(0)
  const latestPersistedSessionsRef = useRef(
    JSON.stringify({ sessions: storedSessions, activeSessionId: storedActiveSessionId })
  )

  // Register default tool renderer (wildcard "*")
  useDefaultTool(({ name, args, status, result }) => (
    <ToolCallDisplay name={name} args={args} status={status} result={result} />
  ))

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
          region: config.awsRegion || "us-east-1",
        })

        setClient(agentClient)
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error"
        setError(`Configuration error: ${errorMessage}`)
        console.error("Failed to load agent configuration:", err)
      }
    }

    loadConfig()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    if (!sessions.some(session => session.id === sessionId) && sessions[0]) {
      setSessionId(sessions[0].id)
      setMessages(sessions[0].history ?? [])
      setRepository(sessions[0].repository ?? null)
      setPullRequest(sessions[0].pullRequest ?? null)
      setPendingUserHandoff(sessions[0].pendingUserHandoff ?? null)
    }
  }, [sessionId, sessions])

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
        const loadedSessions = response.sessions
        const nextSessions = loadedSessions.length > 0 ? loadedSessions : [createChatSession()]
        const activeSession =
          nextSessions.find(session => session.id === response.activeSessionId) ?? nextSessions[0]
        setSessions(nextSessions)
        setSessionId(activeSession.id)
        setMessages(activeSession.history ?? [])
        setRepository(activeSession.repository ?? null)
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

    const nextSessions = storedSessionsFromStore
    const nextSession =
      nextSessions.find(session => session.id === storedActiveSessionIdFromStore) ?? nextSessions[0]
    if (!nextSession) return
    setSessions(nextSessions)
    setSessionId(nextSession.id)
    setMessages(nextSession.history ?? [])
    setRepository(nextSession.repository ?? null)
    setPullRequest(nextSession.pullRequest ?? null)
    setPendingUserHandoff(nextSession.pendingUserHandoff ?? null)
    setInput("")
    setError(null)
  }, [sessionId, sessions, storedActiveSessionIdFromStore, storedSessionsFromStore])

  useEffect(() => {
    if (!repositoryChatRequest || handledRepositoryChatRequestRef.current === repositoryChatRequest.id) return
    handledRepositoryChatRequestRef.current = repositoryChatRequest.id
    const next = createChatSession(repositoryChatRequest.repository)
    activateSession(next)
    setInput(repositoryChatRequest.prompt)
    setIsSetupOpen(false)
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
              pullRequest,
              pendingUserHandoff,
              endDate: lastMessageTimestamp ?? session.endDate,
            }
          : session
      )
    )
  }, [messages, pendingUserHandoff, pullRequest, repository, sessionId])

  useEffect(() => {
    if (!client || !auth.user?.access_token || (repository && !isSetupOpen)) return
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
          if (repository?.fullName) return repository.fullName
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
  }, [auth.user?.access_token, client, isSetupOpen, repository])

  const sendMessage = async (userMessage: string, messageAttachments: ChatAttachment[] = []) => {
    const trimmedMessage = userMessage.trim()
    if ((!trimmedMessage && messageAttachments.length === 0) || !client) return

    // Clear any previous errors
    setError(null)
    const mentionedAgent = findMentionedAgent(userMessage)
    const activeAgent = mentionedAgent ?? selectedAgent
    const selectedRepository =
      repository ??
      installedRepositories.find(item => item.fullName === selectedInstalledRepository) ??
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
      setRepository(selectedRepository)
      setSessions(prev =>
        prev.map(session =>
          session.id === sessionId
            ? {
                ...session,
                repository: selectedRepository,
                endDate: newUserMessage.timestamp,
              }
            : session
        )
      )
    }
    setMessages(prev => [...prev, newUserMessage])
    setInput("")
    setAttachments([])
    setPendingUserHandoff(null)
    setIsLoading(true)

    // Create placeholder for assistant response
    const assistantResponse: Message = {
      role: "assistant",
      content: "Thinking...",
      timestamp: new Date().toISOString(),
      agent: activeAgent,
    }

    setMessages(prev => [...prev, assistantResponse])

    try {
      // Get auth token from react-oidc-context
      const accessToken = auth.user?.access_token

      if (!accessToken) {
        throw new Error("Authentication required. Please log in again.")
      }

      const segments: MessageSegment[] = []
      const toolCallMap = new Map<string, ToolCall>()
      const abortController = new AbortController()
      abortControllerRef.current = abortController

      const updateMessage = () => {
        // Build content from text segments for backward compat
        const content = segments
          .filter((s): s is Extract<MessageSegment, { type: "text" }> => s.type === "text")
          .map(s => s.content)
          .join("")

        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content: content || "Thinking...",
            segments: [...segments],
          }
          return updated
        })
      }

      // User identity is extracted server-side from the validated JWT token,
      // not passed as a parameter — prevents impersonation via prompt injection.
      await client.invoke(trimmedMessage || "Please review the attached file(s).", sessionId, accessToken, event => {
        switch (event.type) {
          case "agent": {
            setMessages(prev => {
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
            setPullRequest(nextPullRequest)
            break
          }
          case "session_title": {
            const title = event.title.trim()
            if (title) {
              setSessions(prev =>
                prev.map(session =>
                  session.id === sessionId
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
            setPendingUserHandoff(event.handoff as UserHandoff)
            break
          }
        }
      }, selectedRepository, activeAgent, messageAttachments, abortController.signal)
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setMessages(prev => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          updated[updated.length - 1] = {
            ...last,
            content: last.content === "Thinking..." ? "Stopped." : last.content,
          }
          return updated
        })
        return
      }
      const errorMessage = err instanceof Error ? err.message : "Unknown error"
      setError(`Failed to get response: ${errorMessage}`)
      console.error("Error invoking AgentCore:", err)

      // Update the assistant message with error
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          content:
            "I apologize, but I encountered an error processing your request. Please try again.",
        }
        return updated
      })
    } finally {
      abortControllerRef.current = null
      setIsLoading(false)
    }
  }

  const stopMessage = useCallback(() => {
    abortControllerRef.current?.abort()
  }, [])

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
    setSelectedInstalledRepository(next.repository?.fullName ?? NO_REPOSITORY_VALUE)
    setPullRequest(next.pullRequest ?? null)
    setPendingUserHandoff(next.pendingUserHandoff ?? null)
    setInput("")
    setError(null)
  }

  const handleUserHandoffSubmit = (answers: string) => {
    setPendingUserHandoff(null)
    void sendMessage(answers, [])
  }

  const setupSession = async () => {
    setIsSettingUpSession(true)
    setSetupError(null)
    try {
      if (!client) throw new Error("Agent runtime is not configured yet")
      const accessToken = auth.user?.access_token
      if (!accessToken) throw new Error("Authentication required. Please log in again.")
      const requestedRepository = installedRepositories.find(item => item.fullName === selectedInstalledRepository)
      if (!requestedRepository) throw new Error("Choose an installed GitHub App repository")
      const previewResponse = await client.githubAction("previewPullRequest", sessionId, accessToken, requestedRepository)
      const currentSession = sessions.find(session => session.id === sessionId)
      const next = {
        ...(currentSession ?? createChatSession(null, sessionId)),
        repository: requestedRepository,
      }
      const preview = (previewResponse as any)?.preview
      if (preview?.number || preview?.url) {
        next.pullRequest = {
          number: preview.number,
          url: preview.url,
          state: preview.state,
          title: preview.title,
          headBranch: preview.headBranch,
          baseBranch: preview.baseBranch,
        }
      }
      activateSession(next)
      setIsSetupOpen(false)
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : "Failed to set up GitHub repository")
    } finally {
      setIsSettingUpSession(false)
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

  // Check if this is the initial state (no messages)
  const isInitialState = messages.length === 0
  const isRepositoryLocked = Boolean(repository) && (messages.length > 0 || isLoading)
  const selectedRepositoryFullName = repository?.fullName || selectedInstalledRepository || NO_REPOSITORY_VALUE
  const showFilesystem = Boolean(repository && isFilesystemOpen)

  return (
    <div
      className={`relative grid h-screen w-full grid-cols-1 overflow-hidden bg-white transition-[grid-template-columns] duration-300 ${
        showFilesystem
          ? "lg:grid-cols-[minmax(360px,1fr)_minmax(520px,42vw)]"
          : "lg:grid-cols-[minmax(0,1fr)_minmax(0,0px)]"
      }`}
    >
      <section className="flex min-h-0 min-w-0 flex-col bg-white text-slate-950">
      {/* Fixed header */}
      <div className="flex-none">
        {!repository && (
          <div className="mx-4 mt-2 flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-sm text-slate-600">
              No repository connected. Pick a GitHub repository in the message box before the first send if this chat should inspect files or open a pull request.
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={isRepositoryLocked}
              onClick={() => setIsSetupOpen(true)}
            >
              Connect Repository
            </Button>
          </div>
        )}
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
                messagesEndRef={messagesEndRef}
              />
            </div>
          </div>
        </>
      )}
      </section>
      {repository && (
        <button
          type="button"
          className={`absolute top-1/2 z-50 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition-[right,background-color] hover:bg-slate-50 lg:flex ${
            isFilesystemOpen ? "right-[calc(42vw+0.75rem)]" : "right-3"
          }`}
          onClick={() => setIsFilesystemOpen(open => !open)}
          aria-label={isFilesystemOpen ? "Collapse filesystem" : "Open filesystem"}
          title={isFilesystemOpen ? "Collapse filesystem" : "Open filesystem"}
        >
          {isFilesystemOpen ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      )}
      <div className="absolute bottom-4 left-1/2 z-40 w-full max-w-5xl -translate-x-1/2 px-4">
        <ChatInput
          input={input}
          setInput={setInput}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          handleSubmit={handleSubmit}
          isLoading={isLoading}
          onStop={stopMessage}
          className="bg-transparent p-0"
          agents={CHAT_AGENTS}
          repositories={installedRepositories}
          selectedRepositoryFullName={selectedRepositoryFullName}
          onRepositoryChange={value => void setupRepositoryWorkspaceForSelection(value)}
          repositoryLocked={isRepositoryLocked}
          isLoadingRepositories={isLoadingInstalledRepositories || isSettingUpSession}
          repositoryError={setupError}
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
            sessionId={sessionId}
            pullRequest={pullRequest}
            onPullRequestChange={setPullRequest}
          />
        )}
      </div>
      <Dialog open={isSetupOpen} onOpenChange={open => {
        if (isSettingUpSession) return
        setIsSetupOpen(open)
      }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Connect Repository</DialogTitle>
            <DialogDescription>
              Chat works without a repository. Connect one when you want the agent to inspect files, prepare changes, or open a pull request.
            </DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Installed repository
            <select
              className="h-10 rounded-md border bg-white px-3 text-sm"
              value={selectedInstalledRepository}
              onChange={event => setSelectedInstalledRepository(event.target.value)}
              disabled={isRepositoryLocked || isSettingUpSession || isLoadingInstalledRepositories}
            >
              {installedRepositories.length === 0 ? (
                 <option value={NO_REPOSITORY_VALUE}>
                  {isLoadingInstalledRepositories ? "Loading repositories..." : "No installed repositories found"}
                </option>
              ) : (
                installedRepositories.map(item => (
                  <option key={item.fullName} value={item.fullName}>
                    {item.fullName} ({item.defaultBranch})
                  </option>
                ))
              )}
            </select>
          </label>
          {setupError && <p className="text-sm text-red-700">{setupError}</p>}
          <Button
            type="button"
            disabled={isRepositoryLocked || isSettingUpSession || !selectedInstalledRepository || selectedInstalledRepository === NO_REPOSITORY_VALUE}
            onClick={() => void setupSession()}
          >
            {isSettingUpSession ? "Connecting Repository" : "Connect Repository"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
