import { lazy, Suspense } from "react"
import { Routes, Route } from "react-router-dom"
import { Navigate } from "react-router-dom"

const ChatPage = lazy(() => import("./ChatPage"))
const SettingsPage = lazy(() => import("./SettingsPage"))
const PullRequestsPage = lazy(() => import("./PullRequestsPage"))
const ResourceCatalogPage = lazy(() => import("./ResourceCatalogPage"))

export default function AppRoutes() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-white" />}>
      <Routes>
        <Route path="/" element={<ChatPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/resource-catalog" element={<ResourceCatalogPage />} />
        <Route path="/drift-guard" element={<Navigate to="/resource-catalog" replace />} />
        <Route path="/pull-requests" element={<PullRequestsPage />} />
      </Routes>
    </Suspense>
  )
}
