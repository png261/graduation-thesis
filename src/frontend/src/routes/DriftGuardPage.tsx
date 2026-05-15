"use client"

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import {
  Bell,
  CalendarClock,
  Mail,
  Play,
  RefreshCw,
  Save,
  ShieldCheck,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InstalledRepositoryCombobox } from "@/components/github/InstalledRepositoryCombobox"
import { useAuth } from "@/hooks/useAuth"
import { useInstalledRepositories } from "@/hooks/useInstalledRepositories"
import type { SelectedRepository } from "@/lib/agentcore-client/types"
import {
  DriftGuard,
  DriftGuardFrequency,
  ResourceScan,
  StateBackend,
  listDriftGuards,
  listResourceScans,
  listStateBackends,
  runDriftGuard,
  saveDriftGuard,
} from "@/services/resourcesService"

const frequencies: Array<{ value: DriftGuardFrequency; label: string }> = [
  { value: "manual", label: "Manual" },
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
]

function formatDate(value?: string): string {
  if (!value) return "-"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function scheduleLabel(frequency: DriftGuardFrequency) {
  switch (frequency) {
    case "hourly":
      return "Runs every hour"
    case "daily":
      return "Runs every day"
    case "weekly":
      return "Runs every 7 days"
    case "monthly":
      return "Runs on day 1 each month"
    default:
      return "Manual runs only"
  }
}

function statusClass(status: string) {
  const value = status.toLowerCase()
  if (value === "running" || value === "in_progress") return "border-sky-200 bg-sky-50 text-sky-700"
  if (value === "failed") return "border-red-200 bg-red-50 text-red-700"
  return "border-emerald-200 bg-emerald-50 text-emerald-700"
}

function GuardForm({
  backends,
  repositories,
  isLoadingRepositories,
  selectedGuard,
  defaultEmail,
  onSave,
  isSaving,
}: {
  backends: StateBackend[]
  repositories: SelectedRepository[]
  isLoadingRepositories: boolean
  selectedGuard: DriftGuard | null
  defaultEmail: string
  onSave: (payload: {
    guardId?: string
    name: string
    backendId: string
    repository: string
    frequency: DriftGuardFrequency
    email: string
    enabled: boolean
  }) => Promise<void>
  isSaving: boolean
}) {
  const [form, setForm] = useState({
    guardId: selectedGuard?.guardId || "",
    name: selectedGuard?.name || "",
    backendId: selectedGuard?.backendId || backends[0]?.backendId || "",
    repository: selectedGuard?.repository || "",
    frequency: selectedGuard?.frequency || "manual" as DriftGuardFrequency,
    email: selectedGuard?.email || defaultEmail,
    enabled: selectedGuard?.enabled ?? true,
  })

  useEffect(() => {
    const selectedRepositoryIsInstalled =
      !selectedGuard?.repository || repositories.some(repository => repository.fullName === selectedGuard.repository)
    setForm({
      guardId: selectedGuard?.guardId || "",
      name: selectedGuard?.name || "",
      backendId: selectedGuard?.backendId || backends[0]?.backendId || "",
      repository: selectedRepositoryIsInstalled ? selectedGuard?.repository || "" : "",
      frequency: selectedGuard?.frequency || "manual",
      email: selectedGuard?.email || defaultEmail,
      enabled: selectedGuard?.enabled ?? true,
    })
  }, [backends, defaultEmail, repositories, selectedGuard])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!repositories.some(repository => repository.fullName === form.repository)) return
    await onSave(form)
  }

  return (
    <form className="rounded-lg border border-slate-200 bg-white p-5" onSubmit={handleSubmit}>
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-5 w-5 text-slate-800" />
        <div>
          <h2 className="text-base font-semibold text-slate-900">Drift Guard Settings</h2>
          <p className="mt-1 text-sm text-slate-500">Connect a repository, backend state, schedule, and drift email alert.</p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Guard Name
          <Input value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Repository
          <InstalledRepositoryCombobox
            repositories={repositories}
            value={form.repository}
            onValueChange={repository => setForm(current => ({ ...current, repository }))}
            isLoading={isLoadingRepositories}
            placeholder="Select installed repository"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          State Backend
          <select
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400 focus:ring-[3px] focus:ring-slate-200"
            value={form.backendId}
            onChange={event => setForm(current => ({ ...current, backendId: event.target.value }))}
          >
            {backends.length === 0 ? (
              <option value="">No state backend configured</option>
            ) : (
              backends.map(backend => (
                <option key={backend.backendId} value={backend.backendId}>
                  {backend.name} ({backend.region})
                </option>
              ))
            )}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Frequency
          <select
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400 focus:ring-[3px] focus:ring-slate-200"
            value={form.frequency}
            onChange={event =>
              setForm(current => ({ ...current, frequency: event.target.value as DriftGuardFrequency }))
            }
          >
            {frequencies.map(item => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Drift Alert Email
          <Input
            type="email"
            value={form.email}
            onChange={event => setForm(current => ({ ...current, email: event.target.value }))}
            placeholder="you@example.com"
          />
        </label>
        <label className="flex items-center gap-2 pt-6 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={event => setForm(current => ({ ...current, enabled: event.target.checked }))}
          />
          Enabled
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          disabled={
            isSaving ||
            !form.name ||
            !form.backendId ||
            !repositories.some(repository => repository.fullName === form.repository)
          }
          className="gap-2"
        >
          <Save className="h-4 w-4" />
          {isSaving ? "Saving" : selectedGuard ? "Save Settings" : "Create Drift Guard"}
        </Button>
        <p className="text-sm text-slate-500">
          Email subscriptions require confirmation from the recipient before alerts are delivered.
        </p>
      </div>
    </form>
  )
}

export default function DriftGuardPage() {
  const auth = useAuth()
  const {
    repositories,
    isLoading: isLoadingRepositories,
    error: repositoriesError,
  } = useInstalledRepositories(auth.user?.access_token)
  const [backends, setBackends] = useState<StateBackend[]>([])
  const [guards, setGuards] = useState<DriftGuard[]>([])
  const [scans, setScans] = useState<ResourceScan[]>([])
  const [selectedGuardId, setSelectedGuardId] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectedGuard = guards.find(guard => guard.guardId === selectedGuardId) ?? null
  const userEmail = String((auth.user?.profile as Record<string, unknown> | undefined)?.email || "")

  const refresh = useCallback(async () => {
    const idToken = auth.user?.id_token
    if (!idToken) return
    setIsLoading(true)
    setError(null)
    try {
      const [loadedBackends, loadedGuards, loadedScans] = await Promise.all([
        listStateBackends(idToken),
        listDriftGuards(idToken),
        listResourceScans(idToken),
      ])
      setBackends(loadedBackends)
      setGuards(loadedGuards)
      setScans(loadedScans)
      setSelectedGuardId(current => current || loadedGuards[0]?.guardId || "")
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load Drift Guard")
    } finally {
      setIsLoading(false)
    }
  }, [auth.user?.id_token])

  useEffect(() => {
    refresh()
  }, [refresh])

  const guardScans = useMemo(() => {
    if (!selectedGuard) return []
    return scans.filter(scan => scan.guardId === selectedGuard.guardId || scan.backendId === selectedGuard.backendId)
  }, [scans, selectedGuard])

  async function handleSave(payload: {
    guardId?: string
    name: string
    backendId: string
    repository: string
    frequency: DriftGuardFrequency
    email: string
    enabled: boolean
  }) {
    const idToken = auth.user?.id_token
    if (!idToken) {
      setError("Sign in before saving Drift Guard settings")
      return
    }
    setIsSaving(true)
    setMessage(null)
    setError(null)
    try {
      const saved = await saveDriftGuard(payload, idToken)
      setGuards(current => [saved, ...current.filter(item => item.guardId !== saved.guardId)])
      setSelectedGuardId(saved.guardId)
      setMessage(saved.frequency === "manual" ? "Drift Guard saved for manual scans" : "Drift Guard schedule saved")
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save Drift Guard")
    } finally {
      setIsSaving(false)
    }
  }

  async function handleRunNow() {
    const idToken = auth.user?.id_token
    if (!idToken || !selectedGuard) return
    setIsRunning(true)
    setMessage(null)
    setError(null)
    try {
      const result = await runDriftGuard(selectedGuard.guardId, idToken)
      if (result.scan) {
        setScans(current => [result.scan!, ...current])
        setGuards(current =>
          current.map(guard =>
            guard.guardId === selectedGuard.guardId
              ? { ...guard, lastScanId: result.scan!.scanId, lastRunAt: result.scan!.startedAt }
              : guard
          )
        )
      }
      setMessage(result.skipped ? `Run skipped: ${result.reason}` : "Cloudrift scan started")
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Failed to run Drift Guard")
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
              <CalendarClock className="h-4 w-4" />
              Cloudrift automation
            </div>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">Drift Guard</h1>
          </div>
          <Button type="button" variant="outline" onClick={() => void refresh()} disabled={isLoading} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            Reload
          </Button>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-4 p-6 lg:grid-cols-[360px_1fr]">
        <aside className="flex flex-col gap-4">
          {message && <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
          {error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {repositoriesError && (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
              {repositoriesError}
            </p>
          )}
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-base font-semibold text-slate-900">Configured Guards</h2>
            <div className="mt-3 flex flex-col gap-2">
              {guards.length === 0 && <p className="text-sm text-slate-500">No Drift Guard configured yet.</p>}
              {guards.map(guard => (
                <button
                  key={guard.guardId}
                  type="button"
                  onClick={() => setSelectedGuardId(guard.guardId)}
                  className={`rounded-md border p-3 text-left text-sm transition ${
                    selectedGuardId === guard.guardId
                      ? "border-slate-950 bg-slate-100"
                      : "border-slate-200 hover:bg-slate-50/80"
                  }`}
                >
                  <span className="block font-semibold text-slate-900">{guard.name}</span>
                  <span className="block text-slate-500">{scheduleLabel(guard.frequency)}</span>
                  <span className="block break-all text-slate-500">{guard.repository || "No repository linked"}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
            <div className="flex items-center gap-2 font-semibold text-slate-900">
              <Bell className="h-4 w-4" />
              Email Alerts
            </div>
            <p className="mt-2">Drift Guard sends an SNS email only when Cloudrift returns drift findings.</p>
          </div>
        </aside>

        <div className="flex min-w-0 flex-col gap-4">
          <GuardForm
            backends={backends}
            repositories={repositories}
            isLoadingRepositories={isLoadingRepositories}
            selectedGuard={selectedGuard}
            defaultEmail={userEmail}
            onSave={handleSave}
            isSaving={isSaving}
          />

          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Manual Scan Control</h2>
                <p className="mt-1 text-sm text-slate-500">Run the selected Drift Guard immediately.</p>
              </div>
              <Button type="button" onClick={() => void handleRunNow()} disabled={!selectedGuard || isRunning} className="gap-2">
                <Play className="h-4 w-4" />
                {isRunning ? "Starting" : "Run Now"}
              </Button>
            </div>
            {selectedGuard ? (
              <div className="mt-4 grid gap-3 text-sm text-slate-600 md:grid-cols-2">
                <p><span className="font-medium text-slate-800">Schedule:</span> {scheduleLabel(selectedGuard.frequency)}</p>
                <p><span className="font-medium text-slate-800">Enabled:</span> {selectedGuard.enabled ? "Yes" : "No"}</p>
                <p><span className="font-medium text-slate-800">Email:</span> {selectedGuard.email || "-"}</p>
                <p><span className="font-medium text-slate-800">Last run:</span> {formatDate(selectedGuard.lastRunAt)}</p>
                <p><span className="font-medium text-slate-800">Schedule name:</span> {selectedGuard.scheduleName || "-"}</p>
                <p><span className="font-medium text-slate-800">Alert topic:</span> {selectedGuard.alertTopicArn ? "Configured" : "-"}</p>
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-500">Save a Drift Guard before running scans.</p>
            )}
          </section>

          <section className="rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center gap-2 border-b p-4">
              <Mail className="h-4 w-4 text-slate-700" />
              <h2 className="text-base font-semibold text-slate-900">Recent Guard Scans</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="border-b border-slate-200 bg-white text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Backend</th>
                    <th className="px-4 py-3">Alerts</th>
                    <th className="px-4 py-3">Started</th>
                    <th className="px-4 py-3">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {guardScans.map(scan => (
                    <tr key={scan.scanId} className="hover:bg-slate-50/80">
                      <td className="px-4 py-4">
                        <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusClass(scan.status)}`}>{scan.status}</span>
                      </td>
                      <td className="px-4 py-4">
                        <p className="font-semibold text-slate-900">{scan.backendName || scan.backendId}</p>
                        <p className="break-all text-xs text-slate-500">s3://{scan.stateBucket}/{scan.stateKey}</p>
                      </td>
                      <td className="px-4 py-4 text-slate-600">{scan.driftAlerts.length} drift / {scan.policyAlerts.length} policy</td>
                      <td className="px-4 py-4 text-slate-600">{formatDate(scan.startedAt)}</td>
                      <td className="px-4 py-4 text-slate-600">{formatDate(scan.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {guardScans.length === 0 && <p className="p-4 text-sm text-slate-500">No scans for this guard yet.</p>}
            </div>
          </section>
        </div>
      </section>
    </main>
  )
}
