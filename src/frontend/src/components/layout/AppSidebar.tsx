import { Link, useLocation, useNavigate } from "react-router-dom"
import {
  ChevronLeft,
  ChevronRight,
  Database,
  GitPullRequest,
  Loader2,
  LogOut,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Settings,
  Trash2,
  UserCircle,
} from "lucide-react"
import { type KeyboardEvent, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { ChatSession } from "@/components/chat/types"
import { useRunningSessions } from "@/components/chat/running-sessions"
import { hasFirstAgentResponse } from "@/components/chat/session-utils"
import { useAuth } from "@/hooks/useAuth"
import { cn } from "@/lib/utils"
import { useWebAppStore } from "@/stores/webAppStore"

const navItems = [
  { to: "/pull-requests", label: "Pull Requests", icon: GitPullRequest },
  { to: "/resource-catalog", label: "Resource Catalog", icon: Database },
  { to: "/settings", label: "Settings", icon: Settings },
]

type AppSidebarProps = {
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
}

function chatTitle(session: ChatSession) {
  return session.name || session.repository?.fullName || "New chat"
}

function chatMetadata(session: ChatSession) {
  return [
    session.stateBackend?.name,
    session.repository?.fullName,
  ].filter(Boolean).join(" · ")
}

function sessionTime(session: ChatSession) {
  const time = Date.parse(session.endDate || session.startDate || "")
  return Number.isNaN(time) ? 0 : time
}

export function AppSidebar({ collapsed = false, onCollapsedChange }: AppSidebarProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const auth = useAuth()
  const storedSessions = useWebAppStore(state => state.sessions)
  const sessions = useMemo(
    () =>
      [...storedSessions]
        .filter(hasFirstAgentResponse)
        .sort((a, b) => {
          if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
          return sessionTime(b) - sessionTime(a)
        }),
    [storedSessions]
  )
  const activeSessionId = useWebAppStore(state => state.activeSessionId)
  const runningSessions = useRunningSessions()
  const setActiveSessionId = useWebAppStore(state => state.setActiveSessionId)
  const requestNewChat = useWebAppStore(state => state.requestNewChat)
  const deleteChatSession = useWebAppStore(state => state.deleteChatSession)
  const hydrateChatSessions = useWebAppStore(state => state.hydrateChatSessions)
  const setSessions = useWebAppStore(state => state.setSessions)
  const persistChatSessions = useWebAppStore(state => state.persistChatSessions)
  const profile = auth.user?.profile as Record<string, unknown> | undefined
  const accountLabel = String(
    profile?.email || profile?.preferred_username || profile?.name || profile?.sub || "Signed in"
  )

  function isCurrent(to: string): boolean {
    const [pathname, search = ""] = to.split("?")
    if (pathname !== location.pathname) {
      return false
    }
    if (!search) {
      return !location.search || pathname === "/"
    }
    return location.search === `?${search}`
  }

  const isChatRoute = location.pathname === "/"

  function openChatSession(session: ChatSession) {
    setActiveSessionId(session.id)
    navigate("/")
  }

  function handleRecentKeyDown(event: KeyboardEvent<HTMLDivElement>, session: ChatSession) {
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    openChatSession(session)
  }

  function startNewChat() {
    navigate("/")
    requestNewChat()
  }

  function removeChatSession(sessionId: string) {
    const idToken = auth.user?.id_token
    if (!idToken) return
    void deleteChatSession(sessionId, idToken)
    if (activeSessionId === sessionId) {
      navigate("/")
    }
  }

  function updateChatSession(sessionId: string, updater: (session: ChatSession) => ChatSession) {
    const idToken = auth.user?.id_token
    const latestSessions = useWebAppStore.getState().sessions
    const nextSessions = latestSessions.map(session => (
      session.id === sessionId ? updater(session) : session
    ))
    setSessions(nextSessions)
    if (idToken) void persistChatSessions(idToken)
  }

  function togglePinned(session: ChatSession) {
    updateChatSession(session.id, current => ({ ...current, pinned: !current.pinned }))
  }

  function renameChatSession(session: ChatSession) {
    const nextName = window.prompt("Rename chat", chatTitle(session))?.trim()
    if (!nextName) return
    updateChatSession(session.id, current => ({ ...current, name: nextName }))
  }

  useEffect(() => {
    const idToken = auth.user?.id_token
    if (!idToken) return
    void hydrateChatSessions(idToken)
  }, [auth.user?.id_token, hydrateChatSessions])

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 hidden h-screen shrink-0 flex-col border-r bg-white transition-[width] duration-200 lg:flex",
        collapsed ? "w-16" : "w-64"
      )}
    >
      <div className={cn("flex items-center py-4", collapsed ? "justify-center px-2" : "justify-between px-5")}>
        {!collapsed && <span className="text-lg font-semibold tracking-normal text-slate-950">InfraQ</span>}
        <Button
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn("h-8 w-8", collapsed && "absolute left-12 top-4 bg-white shadow-sm")}
          onClick={() => onCollapsedChange?.(!collapsed)}
          size="icon"
          type="button"
          variant="ghost"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Button
          aria-label="New Chat"
          className={cn(
            "mb-1 h-9 bg-white text-slate-950 hover:bg-slate-100",
            collapsed ? "w-full justify-center px-0" : "justify-start gap-2"
          )}
          onClick={startNewChat}
          title={collapsed ? "New Chat" : undefined}
          type="button"
          variant="ghost"
        >
          <Plus className="h-4 w-4" />
          {!collapsed && "New Chat"}
        </Button>

        {navItems.map(item => {
          const Icon = item.icon
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-label={item.label}
              title={collapsed ? item.label : undefined}
              className={`flex items-center rounded-md py-2 text-sm font-medium no-underline transition hover:no-underline ${
                isCurrent(item.to)
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
              } ${collapsed ? "justify-center px-2" : "gap-3 px-3"}`}
            >
              <Icon className="h-4 w-4" />
              {!collapsed && item.label}
            </Link>
          )
        })}

        <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2 pt-3">
          {!collapsed && (
            <div className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Recents
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto pb-28 pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {sessions.length > 0 ? (
              <div className="flex flex-col gap-1">
                {sessions.map(session => {
                  const isRunning = Boolean(runningSessions[session.id])
                  const isActiveRecent = isChatRoute && activeSessionId === session.id
                  const metadata = chatMetadata(session)
                  return (
                    <div
                      aria-label={`Open chat ${chatTitle(session)}`}
                      className={cn(
                        "group flex w-full min-w-0 cursor-pointer items-start gap-1 rounded-md px-2 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400",
                        isActiveRecent
                          ? "bg-slate-100 text-slate-950"
                          : "text-slate-500 hover:bg-slate-50 hover:text-slate-950"
                      )}
                      key={session.id}
                      onClick={() => openChatSession(session)}
                      onKeyDown={event => handleRecentKeyDown(event, session)}
                      role="button"
                      tabIndex={0}
                      title={collapsed ? chatTitle(session) : undefined}
                    >
                      <div
                        className={cn(
                          "flex min-w-0 flex-1 items-start text-left",
                          collapsed ? "justify-center" : "gap-2"
                        )}
                      >
                        {isRunning ? (
                          <Loader2
                            aria-label="Agent responding"
                            className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-sky-600"
                          />
                        ) : collapsed ? (
                          <span className="text-sm font-medium">{chatTitle(session).slice(0, 1).toUpperCase()}</span>
                        ) : null}
                        {!collapsed && <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="block min-w-0 truncate text-sm font-medium">
                              {chatTitle(session)}
                            </span>
                          </span>
                          {(isRunning || metadata) && (
                            <span className="mt-0.5 block min-w-0 truncate text-xs text-slate-400">
                              {isRunning ? "Responding..." : metadata}
                            </span>
                          )}
                        </span>}
                      </div>
                      {!collapsed && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              aria-label={`Chat actions for ${chatTitle(session)}`}
                              className="h-7 w-7 shrink-0 text-slate-400 opacity-0 hover:bg-slate-100 hover:text-slate-950 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                              onClick={event => event.stopPropagation()}
                              size="icon"
                              type="button"
                              variant="ghost"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent align="end" className="w-44 p-1">
                            <button
                              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 hover:text-slate-950"
                              onClick={() => togglePinned(session)}
                              type="button"
                            >
                              <Pin className="h-4 w-4" />
                              {session.pinned ? "Unpin" : "Pin"}
                            </button>
                            <button
                              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 hover:text-slate-950"
                              onClick={() => renameChatSession(session)}
                              type="button"
                            >
                              <Pencil className="h-4 w-4" />
                              Rename
                            </button>
                            <button
                              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                              onClick={() => removeChatSession(session.id)}
                              type="button"
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete
                            </button>
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="px-2 py-4 text-center text-sm text-slate-500">
                No chats yet.
              </div>
            )}
          </div>
        </div>
      </nav>
      {auth.isAuthenticated && (
        <div className="p-3">
          <div className={cn("mb-2 flex min-w-0 items-center rounded-md py-1.5 text-slate-700", collapsed ? "justify-center px-0" : "gap-2 px-2")}>
            <UserCircle className="h-4 w-4 shrink-0" />
            {!collapsed && <span className="truncate text-sm font-medium">{accountLabel}</span>}
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                aria-label="Logout"
                className={cn(
                  "h-9 w-full bg-white text-slate-950 hover:bg-slate-100",
                  collapsed ? "justify-center px-0" : "justify-start gap-2"
                )}
                title={collapsed ? "Logout" : undefined}
                variant="ghost"
              >
                <LogOut className="h-4 w-4" />
                {!collapsed && "Logout"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirm Logout</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to log out? You will need to sign in again to access your
                  account.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => auth.signOut()}>Confirm</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </aside>
  )
}
