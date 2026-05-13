import { lazy, Suspense } from "react"
import { Routes, Route } from "react-router-dom"

const ChatPage = lazy(() => import("./ChatPage"))
const SettingsPage = lazy(() => import("./SettingsPage"))
const PullRequestsPage = lazy(() => import("./PullRequestsPage"))
const ResourceCatalogPage = lazy(() => import("./ResourceCatalogPage"))
const DriftGuardPage = lazy(() => import("./DriftGuardPage"))

export default function AppRoutes() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-slate-50" />}>
      <Routes>
        <Route path="/" element={<ChatPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/resource-catalog" element={<ResourceCatalogPage />} />
        <Route path="/drift-guard" element={<DriftGuardPage />} />
        <Route path="/pull-requests" element={<PullRequestsPage />} />
      </Routes>
    </Suspense>
  )
}
