import { Link, useLocation, useNavigate } from "react-router-dom"
import {
  ChevronLeft,
  ChevronRight,
  Database,
  GitPullRequest,
  Loader2,
  LogOut,
  MessageSquare,
  Plus,
  Settings,
  Trash2,
  UserCircle,
} from "lucide-react"
import { useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import infraqLogo from "@/assets/infraq-logo.svg"
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
import type { ChatSession } from "@/components/chat/types"
import { useRunningSessions } from "@/components/chat/running-sessions"
import { isEmptyNewChatSession } from "@/components/chat/session-utils"
import { useAuth } from "@/hooks/useAuth"
import { cn } from "@/lib/utils"
import { useWebAppStore } from "@/stores/webAppStore"

const navItems = [
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/pull-requests", label: "Pull Requests", icon: GitPullRequest },
  { to: "/resource-catalog", label: "Resource Catalog", icon: Database },
]

type AppSidebarProps = {
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
}

function relativeTime(value?: string) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const diff = Date.now() - date.getTime()
  const minutes = Math.max(1, Math.round(diff / 60000))
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function AppSidebar({ collapsed = false, onCollapsedChange }: AppSidebarProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const auth = useAuth()
  const storedSessions = useWebAppStore(state => state.sessions)
  const sessions = useMemo(
    () =>
      [...storedSessions]
        .sort((a, b) => {
          const bTime = Date.parse(b.endDate || b.startDate || "")
          const aTime = Date.parse(a.endDate || a.startDate || "")
          return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime)
        }),
    [storedSessions]
  )
  const activeSessionId = useWebAppStore(state => state.activeSessionId)
  const runningSessions = useRunningSessions()
  const setActiveSessionId = useWebAppStore(state => state.setActiveSessionId)
  const requestNewChat = useWebAppStore(state => state.requestNewChat)
  const deleteChatSession = useWebAppStore(state => state.deleteChatSession)
  const hydrateChatSessions = useWebAppStore(state => state.hydrateChatSessions)
  const profile = auth.user?.profile as Record<string, unknown> | undefined
  const accountLabel = String(
    profile?.email || profile?.preferred_username || profile?.name || profile?.sub || "Signed in"
  )
  const hasEmptyNewChat = sessions.some(isEmptyNewChatSession)

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

  function openChatSession(session: ChatSession) {
    setActiveSessionId(session.id)
    navigate("/")
  }

  function startNewChat() {
    if (hasEmptyNewChat) return
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
      <div className={cn("flex items-center border-b py-4", collapsed ? "justify-center px-2" : "justify-between px-5")}>
        <img src={infraqLogo} alt="InfraQ" className={cn("h-11 w-auto", collapsed && "h-8 max-w-8")} />
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

        <div className="mt-2 flex min-h-0 flex-col gap-2 border-t border-slate-200 pt-3">
          <Button
            aria-label="New Chat"
            className={cn(
              "h-9 border-slate-300 bg-white text-slate-950 hover:bg-slate-100",
              collapsed ? "w-full justify-center px-0" : "justify-start gap-2"
            )}
            disabled={hasEmptyNewChat}
            onClick={startNewChat}
            title={collapsed ? "New Chat" : undefined}
            type="button"
            variant="outline"
          >
            <Plus className="h-4 w-4" />
            {!collapsed && "New Chat"}
          </Button>
          <div className="min-h-0 flex-1 overflow-y-auto pb-28 pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {sessions.length > 0 ? (
              <div className="flex flex-col gap-1">
                {sessions.map(session => {
                  const isRunning = Boolean(runningSessions[session.id])
                  return (
                    <div
                      className={cn(
                        "group flex w-full min-w-0 items-start gap-1 rounded-md px-2 py-2 text-left transition",
                        activeSessionId === session.id
                          ? "bg-slate-100 text-slate-950"
                          : "text-slate-500 hover:bg-slate-50 hover:text-slate-950"
                      )}
                      key={session.id}
                    >
                      <button
                        aria-label={`Open chat ${session.repository?.fullName ?? session.name ?? "New chat"}`}
                        className={cn(
                          "flex min-w-0 flex-1 items-start text-left",
                          collapsed ? "justify-center gap-0" : "gap-2"
                        )}
                        onClick={() => openChatSession(session)}
                        title={collapsed ? session.repository?.fullName ?? session.name ?? "New chat" : undefined}
                        type="button"
                      >
                        {isRunning ? (
                          <Loader2
                            aria-label="Agent responding"
                            className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-sky-600"
                          />
                        ) : (
                          <MessageSquare className="mt-0.5 h-4 w-4 shrink-0" />
                        )}
                        {!collapsed && <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="block min-w-0 truncate text-sm font-medium">
                              {session.repository?.fullName ?? session.name ?? "New chat"}
                            </span>
                          </span>
                          <span className="mt-1 flex items-center gap-1 text-xs">
                            {isRunning ? (
                              "Responding..."
                            ) : session.pullRequest?.number ? (
                              <>
                                <GitPullRequest className="h-3 w-3" />
                                PR #{session.pullRequest.number}
                              </>
                            ) : (
                              relativeTime(session.endDate)
                            )}
                          </span>
                        </span>}
                      </button>
                      {!collapsed && <Button
                        aria-label={`Delete ${session.repository?.fullName ?? session.name ?? "chat"}`}
                        className="h-7 w-7 shrink-0 text-slate-400 opacity-0 hover:bg-red-50 hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100"
                        onClick={() => removeChatSession(session.id)}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>}
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
        <div className="border-t border-slate-200 p-3">
          <div className={cn("mb-2 flex min-w-0 items-center rounded-md py-1.5 text-slate-700", collapsed ? "justify-center px-0" : "gap-2 px-2")}>
            <UserCircle className="h-4 w-4 shrink-0" />
            {!collapsed && <span className="truncate text-sm font-medium">{accountLabel}</span>}
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                aria-label="Logout"
                className={cn(
                  "h-9 w-full border-slate-300 bg-white text-slate-950 hover:bg-slate-100",
                  collapsed ? "justify-center px-0" : "justify-start gap-2"
                )}
                title={collapsed ? "Logout" : undefined}
                variant="outline"
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
