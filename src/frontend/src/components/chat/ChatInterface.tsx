"use client"

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent } from "react"
import { ChatHeader } from "./ChatHeader"
import { ChatInput } from "./ChatInput"
import { ChatMessages } from "./ChatMessages"
import { ChatSession, Message, MessageSegment, ToolCall } from "./types"

import { useGlobal } from "@/app/context/GlobalContext"
import { AgentCoreClient } from "@/lib/agentcore-client"
import { submitFeedback } from "@/services/feedbackService"
import { useAuth } from "react-oidc-context"
import { useDefaultTool } from "@/hooks/useToolRenderer"
import { ToolCallDisplay } from "./ToolCallDisplay"
import { FileSystemPanel } from "@/components/files/FileSystemPanel"
import type { SelectedRepository } from "@/lib/agentcore-client/types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const CHAT_SESSIONS_STORAGE_KEY = "agentcore:chatSessions"
const ACTIVE_CHAT_SESSION_STORAGE_KEY = "agentcore:activeChatSessionId"

function createChatSession(repository: SelectedRepository | null = null, id = crypto.randomUUID()): ChatSession {
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

function loadStoredSessions(): ChatSession[] {
  try {
    const saved = localStorage.getItem(CHAT_SESSIONS_STORAGE_KEY)
    if (!saved) return []
    const parsed = JSON.parse(saved) as ChatSession[]
    return Array.isArray(parsed) ? parsed.filter(session => Boolean(session.repository)) : []
  } catch {
    return []
  }
}

export default function ChatInterface() {
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const stored = loadStoredSessions()
    return stored.length > 0 ? stored : [createChatSession()]
  })
  const [sessionId, setSessionId] = useState(() => {
    const stored = loadStoredSessions()
    const activeId = localStorage.getItem(ACTIVE_CHAT_SESSION_STORAGE_KEY)
    return stored.find(session => session.id === activeId)?.id ?? stored[0]?.id ?? crypto.randomUUID()
  })
  const initialSession = sessions.find(session => session.id === sessionId) ?? sessions[0]
  const [messages, setMessages] = useState<Message[]>(() => initialSession?.history ?? [])
  const [input, setInput] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [client, setClient] = useState<AgentCoreClient | null>(null)
  const [repository, setRepository] = useState<SelectedRepository | null>(() => initialSession?.repository ?? null)
  const [isSetupOpen, setIsSetupOpen] = useState(false)
  const [installedRepositories, setInstalledRepositories] = useState<SelectedRepository[]>([])
  const [selectedInstalledRepository, setSelectedInstalledRepository] = useState("")
  const [isLoadingInstalledRepositories, setIsLoadingInstalledRepositories] = useState(false)
  const [isSettingUpSession, setIsSettingUpSession] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [chatPanePercent, setChatPanePercent] = useState(38)

  const { isLoading, setIsLoading } = useGlobal()
  const auth = useAuth()

  // Ref for message container to enable auto-scrolling
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

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
    }
  }, [sessionId, sessions])

  useEffect(() => {
    localStorage.setItem(
      CHAT_SESSIONS_STORAGE_KEY,
      JSON.stringify(sessions.filter(session => Boolean(session.repository)))
    )
  }, [sessions])

  useEffect(() => {
    localStorage.setItem(ACTIVE_CHAT_SESSION_STORAGE_KEY, sessionId)
  }, [sessionId])

  useEffect(() => {
    const now = new Date().toISOString()
    setSessions(prev =>
      prev.map(session =>
        session.id === sessionId
          ? {
              ...session,
              history: messages,
              repository,
              endDate: now,
              name:
                session.name === "New chat" && messages[0]?.content
                  ? messages[0].content.slice(0, 48)
                  : session.name,
            }
          : session
      )
    )
  }, [messages, repository, sessionId])

  useEffect(() => {
    if (!isSetupOpen || !client || !auth.user?.access_token) return
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
        setSelectedInstalledRepository(current => current || repositories[0]?.fullName || "")
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
  }, [auth.user?.access_token, client, isSetupOpen])

  const sendMessage = async (userMessage: string) => {
    if (!userMessage.trim() || !client) return
    if (!repository) {
      setIsSetupOpen(true)
      setError("Create a chat session connected to a GitHub repository before chatting.")
      return
    }

    // Clear any previous errors
    setError(null)

    // Add user message to chat
    const newUserMessage: Message = {
      role: "user",
      content: userMessage,
      timestamp: new Date().toISOString(),
    }

    setMessages(prev => [...prev, newUserMessage])
    setInput("")
    setIsLoading(true)

    // Create placeholder for assistant response
    const assistantResponse: Message = {
      role: "assistant",
      content: "Thinking...",
      timestamp: new Date().toISOString(),
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
      await client.invoke(userMessage, sessionId, accessToken, event => {
        switch (event.type) {
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
            const tc: ToolCall = {
              toolUseId: event.toolUseId,
              name: event.name,
              input: "",
              status: "streaming",
            }
            toolCallMap.set(event.toolUseId, tc)
            segments.push({ type: "tool", toolCall: tc })
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
        }
      }, repository, abortController.signal)
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

    sendMessage(input)
  }

  const handlePaneResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const container = event.currentTarget.parentElement
    if (!container) return
    const bounds = container.getBoundingClientRect()
    const move = (moveEvent: PointerEvent) => {
      const next = ((moveEvent.clientX - bounds.left) / bounds.width) * 100
      setChatPanePercent(Math.min(65, Math.max(28, next)))
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }, [])

  // Handle feedback submission
  const handleFeedbackSubmit = async (
    messageContent: string,
    feedbackType: "positive" | "negative",
    comment: string
  ) => {
    try {
      // Use ID token for API Gateway Cognito authorizer (not access token)
      const idToken = auth.user?.id_token

      if (!idToken) {
        throw new Error("Authentication required. Please log in again.")
      }

      await submitFeedback(
        {
          sessionId,
          message: messageContent,
          feedbackType,
          comment: comment || undefined,
        },
        idToken
      )

      console.log("Feedback submitted successfully")
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error"
      console.error("Error submitting feedback:", err)
      setError(`Failed to submit feedback: ${errorMessage}`)
    }
  }

  // Start a new chat by clearing messages and generating a fresh session ID.
  // A new UUID is required so the backend treats this as a distinct conversation context.
  const startNewChat = () => {
    setSelectedInstalledRepository(installedRepositories[0]?.fullName ?? "")
    setSetupError(null)
    setError(null)
    setIsSetupOpen(true)
  }

  const selectSession = (next: ChatSession) => {
    setSessionId(next.id)
    setMessages(next.history ?? [])
    setRepository(next.repository ?? null)
    setInput("")
    setError(null)
  }

  const activateSession = (next: ChatSession) => {
    setSessions(prev => [
      next,
      ...prev.filter(session => session.id !== next.id && Boolean(session.repository)),
    ])
    setSessionId(next.id)
    setMessages(next.history ?? [])
    setRepository(next.repository ?? null)
    setInput("")
    setError(null)
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
      const pendingSessionId = crypto.randomUUID()
      await client.githubAction("previewPullRequest", pendingSessionId, accessToken, requestedRepository)
      const next = createChatSession(requestedRepository, pendingSessionId)
      activateSession(next)
      setIsSetupOpen(false)
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : "Failed to set up GitHub repository")
    } finally {
      setIsSettingUpSession(false)
    }
  }

  // Check if this is the initial state (no messages)
  const isInitialState = messages.length === 0

  return (
    <div
      className="grid h-screen w-full grid-cols-1 overflow-hidden lg:grid-cols-[minmax(360px,var(--chat-pane-width))_6px_minmax(520px,1fr)]"
      style={{ "--chat-pane-width": `${chatPanePercent}%` } as CSSProperties}
    >
      <section className="flex min-h-0 min-w-0 flex-col">
      {/* Fixed header */}
      <div className="flex-none">
        <ChatHeader onNewChat={startNewChat} canStartNewChat />
        <div className="flex flex-wrap items-center gap-2 border-b bg-white px-4 py-2">
          <span className="text-xs font-medium text-slate-500">Session</span>
          <select
            className="h-8 min-w-48 rounded-md border bg-white px-2 text-sm"
            onChange={event => {
              const next = sessions.find(session => session.id === event.target.value)
              if (next) selectSession(next)
            }}
            value={sessionId}
          >
            {sessions.map(session => (
              <option key={session.id} value={session.id}>
                {session.name}
              </option>
            ))}
          </select>
          <span className="truncate text-xs text-slate-500">
            {repository ? `Connected to ${repository.fullName}` : "No repository connected"}
          </span>
        </div>
        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 mx-4 mt-2">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
      </div>

      {/* Conditional layout based on repository setup and whether there are messages */}
      {!repository ? (
        <>
          <div className="grow" />
          <div className="mx-auto mb-16 w-full max-w-2xl px-4 text-center">
            <h2 className="text-2xl font-bold text-gray-800">Connect a GitHub Repository</h2>
            <p className="mt-2 text-gray-600">
              Choose an installed repository before chatting.
            </p>
            <Button type="button" className="mt-6" onClick={startNewChat}>
              Set Up Chat Session
            </Button>
          </div>
          <div className="grow" />
        </>
      ) : isInitialState ? (
        // Initial state - input in the middle
        <>
          {/* Empty space above */}
          <div className="grow" />

          {/* Centered welcome message */}
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold text-gray-800">Welcome to FAST Chat</h2>
            <p className="text-gray-600 mt-2">Ask me anything to get started</p>
          </div>

          {/* Centered input */}
          <div className="px-4 mb-16 max-w-4xl mx-auto w-full">
            <ChatInput
              input={input}
              setInput={setInput}
              handleSubmit={handleSubmit}
              isLoading={isLoading}
              onStop={stopMessage}
            />
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
                sessionId={sessionId}
                onFeedbackSubmit={handleFeedbackSubmit}
              />
            </div>
          </div>

          {/* Fixed input area at bottom */}
          <div className="flex-none">
            <div className="max-w-4xl mx-auto w-full">
              <ChatInput
                input={input}
                setInput={setInput}
                handleSubmit={handleSubmit}
                isLoading={isLoading}
                onStop={stopMessage}
              />
            </div>
          </div>
        </>
      )}
      </section>
      <div
        className="hidden cursor-col-resize bg-slate-200 transition hover:bg-slate-300 lg:block"
        role="separator"
        aria-orientation="vertical"
        onPointerDown={handlePaneResize}
      />
      <div className="hidden min-h-0 min-w-0 lg:block">
        <FileSystemPanel
          accessToken={auth.user?.access_token ?? null}
          client={client}
          repository={repository}
          sessionId={sessionId}
        />
      </div>
      <Dialog open={isSetupOpen} onOpenChange={open => {
        if (isSettingUpSession) return
        setIsSetupOpen(open)
      }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Set Up Chat Session</DialogTitle>
            <DialogDescription>
              Choose an installed GitHub repository for this chat. The repository is locked after the session is created.
            </DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Installed repository
            <select
              className="h-10 rounded-md border bg-white px-3 text-sm"
              value={selectedInstalledRepository}
              onChange={event => setSelectedInstalledRepository(event.target.value)}
              disabled={isSettingUpSession || isLoadingInstalledRepositories}
            >
              {installedRepositories.length === 0 ? (
                <option value="">
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
            disabled={isSettingUpSession || !selectedInstalledRepository}
            onClick={() => void setupSession()}
          >
            {isSettingUpSession ? "Cloning Repository" : "Clone Repository and Start"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
