import { BrowserRouter } from "react-router-dom"
import { AuthProvider } from "@/components/auth/AuthProvider"
import { AppSidebar } from "@/components/layout/AppSidebar"
import AppRoutes from "./routes"

function AppShell() {
  return (
    <div className="min-h-screen lg:flex">
      <AppSidebar />
      <div className="min-w-0 flex-1">
        <AppRoutes />
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
