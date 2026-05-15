import { BrowserRouter } from "react-router-dom"
import { useState } from "react"
import { AuthProvider } from "@/components/auth/AuthProvider"
import { AppSidebar } from "@/components/layout/AppSidebar"
import AppRoutes from "./routes"

function AppShell() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)

  return (
    <div className="min-h-screen bg-white">
      <AppSidebar collapsed={isSidebarCollapsed} onCollapsedChange={setIsSidebarCollapsed} />
      <div className={`flex min-h-screen min-w-0 flex-col transition-[padding] duration-200 ${isSidebarCollapsed ? "lg:pl-16" : "lg:pl-64"}`}>
        <main className="min-h-0 flex-1">
          <AppRoutes />
        </main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </BrowserRouter>
  )
}
