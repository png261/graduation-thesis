import { Link, useLocation } from "react-router-dom"
import {
  CalendarClock,
  Database,
  GitPullRequest,
  MessageSquare,
  Settings,
} from "lucide-react"

const navItems = [
  { to: "/", label: "Chat", icon: MessageSquare },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/pull-requests", label: "Pull Requests", icon: GitPullRequest },
  { to: "/resource-catalog", label: "Resource Catalog", icon: Database },
  { to: "/drift-guard", label: "Drift Guard", icon: CalendarClock },
]

export function AppSidebar() {
  const location = useLocation()

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

  return (
    <aside className="relative hidden h-screen w-64 shrink-0 border-r bg-white lg:block">
      <div className="border-b px-5 py-4">
        <p className="text-sm font-medium text-slate-500">Infrastructure</p>
        <h1 className="text-lg font-semibold text-slate-950">Agent Console</h1>
      </div>
      <nav className="flex flex-col gap-1 p-3">
        {navItems.map(item => {
          const Icon = item.icon
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium no-underline transition hover:no-underline ${
                isCurrent(item.to)
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
