"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ExternalLink, GitBranch, RefreshCw, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InstalledRepositoryCombobox } from "@/components/github/InstalledRepositoryCombobox"
import { useAuth } from "@/hooks/useAuth"
import { useInstalledRepositories } from "@/hooks/useInstalledRepositories"
import type { SelectedRepository } from "@/lib/agentcore-client/types"
import {
  GitHubPullRequestStatus,
  listGitHubPullRequests,
} from "@/services/resourcesService"

type PullRequestState = "open" | "closed" | "merged" | "all"

function formatDate(value?: string): string {
  if (!value) return "-"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function statusTone(status?: string): string {
  const normalized = (status || "").toLowerCase()
  if (["success", "completed", "merged"].includes(normalized)) return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (["failure", "error", "timed_out", "cancelled", "action_required"].includes(normalized)) {
    return "border-red-200 bg-red-50 text-red-700"
  }
  if (["pending", "queued", "in_progress", "requested"].includes(normalized)) {
    return "border-amber-200 bg-amber-50 text-amber-700"
  }
  return "border-slate-200 bg-slate-50 text-slate-700"
}

function StatusBadge({ value }: { value?: string }) {
  return (
    <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${statusTone(value)}`}>
      {value || "unknown"}
    </span>
  )
}

export default function PullRequestsPage() {
  const auth = useAuth()
  const {
    repositories,
    isLoading: isLoadingRepositories,
    error: repositoriesError,
  } = useInstalledRepositories(auth.user?.access_token)
  const savedRepository = useMemo(() => {
    const saved = localStorage.getItem("agentcore:selectedRepository")
    if (!saved) return ""
    try {
      const parsed = JSON.parse(saved) as { fullName?: string }
      return parsed.fullName || ""
    } catch {
      return ""
    }
  }, [])
  const [repository, setRepository] = useState(savedRepository)
  const [state, setState] = useState<PullRequestState>("all")
  const [pullRequests, setPullRequests] = useState<GitHubPullRequestStatus[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadPullRequests = useCallback(async () => {
    const idToken = auth.user?.id_token
    if (!idToken || !repository || !repositories.some(item => item.fullName === repository)) return
    setIsLoading(true)
    setError(null)
    try {
      setPullRequests(await listGitHubPullRequests(repository, state, idToken))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pull requests")
    } finally {
      setIsLoading(false)
    }
  }, [auth.user?.id_token, repositories, repository, state])

  useEffect(() => {
    void loadPullRequests()
  }, [loadPullRequests])

  useEffect(() => {
    if (repositories.length === 0) return
    if (repositories.some(item => item.fullName === repository)) return
    selectRepository(repositories[0])
  }, [repositories, repository])

  function selectRepository(next: SelectedRepository) {
    localStorage.setItem("agentcore:selectedRepository", JSON.stringify(next))
    setRepository(next.fullName)
    setError(null)
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Pull Requests</h1>
          <p className="mt-1 text-sm text-slate-500">
            GitHub App-created pull requests with webhook status and checks.
          </p>
        </div>
        <Button onClick={loadPullRequests} variant="outline" disabled={!repository || isLoading} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          {isLoading ? "Loading" : "Reload"}
        </Button>
      </header>

      <section className="mx-auto flex max-w-6xl flex-col gap-4 p-6">
        <section className="rounded-lg border bg-white p-5">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-72 flex-1 flex-col gap-1 text-sm font-medium text-slate-700">
              Repository
              <InstalledRepositoryCombobox
                repositories={repositories}
                value={repository}
                onValueChange={value => {
                  const next = repositories.find(item => item.fullName === value)
                  if (next) selectRepository(next)
                }}
                isLoading={isLoadingRepositories}
                placeholder="Select installed repository"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              State
              <select
                className="h-9 rounded-md border bg-white px-3 text-sm"
                value={state}
                onChange={event => setState(event.target.value as PullRequestState)}
              >
                <option value="open">Open</option>
                <option value="closed">Closed</option>
                <option value="merged">Merged</option>
                <option value="all">All</option>
              </select>
            </label>
          </div>
          {repository && (
            <p className="mt-3 flex items-center gap-2 text-sm text-slate-500">
              <GitBranch className="h-4 w-4" />
              Reading webhook status for {repository}
            </p>
          )}
        </section>

        {error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {repositoriesError && (
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
            {repositoriesError}
          </p>
        )}

        <section className="rounded-lg border bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Webhook Pull Request Status</h2>
              <p className="mt-1 text-sm text-slate-500">
                Showing pull requests opened by the configured GitHub App.
              </p>
            </div>
            <span className="rounded-md border bg-slate-50 px-2 py-1 text-xs text-slate-600">
              {pullRequests.length} pull requests
            </span>
          </div>

          {pullRequests.length === 0 ? (
            <p className="p-5 text-sm text-slate-500">
              No GitHub App-created pull request records found for this repository yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-left text-sm">
                <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Pull Request</th>
                    <th className="px-4 py-3">State</th>
                    <th className="px-4 py-3">Check</th>
                    <th className="px-4 py-3">Branches</th>
                    <th className="px-4 py-3">Last Webhook</th>
                    <th className="px-4 py-3">Updated</th>
                    <th className="px-4 py-3 text-right">Open</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pullRequests.map(pr => (
                    <tr key={`${pr.repository}-${pr.number}`} className="align-top hover:bg-slate-50">
                      <td className="px-4 py-4">
                        <p className="font-semibold text-slate-900">
                          #{pr.number} {pr.title}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {pr.author || "unknown author"} {pr.draft ? "· draft" : ""}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <StatusBadge value={pr.state} />
                      </td>
                      <td className="px-4 py-4">
                        <StatusBadge value={pr.checkConclusion || pr.checkStatus || pr.combinedStatus} />
                        {pr.checkName && <p className="mt-1 text-xs text-slate-500">{pr.checkName}</p>}
                      </td>
                      <td className="px-4 py-4">
                        <p className="font-mono text-xs text-slate-700">{pr.headBranch || "-"}</p>
                        <p className="mt-1 font-mono text-xs text-slate-500">into {pr.baseBranch || "-"}</p>
                      </td>
                      <td className="px-4 py-4">
                        <p className="text-slate-700">{pr.lastEvent || "-"}</p>
                        <p className="mt-1 text-xs text-slate-500">{pr.lastAction || "-"}</p>
                      </td>
                      <td className="px-4 py-4 text-slate-600">
                        {formatDate(pr.mergedAt || pr.githubUpdatedAt || pr.updatedAt)}
                      </td>
                      <td className="px-4 py-4 text-right">
                        {pr.url ? (
                          <a
                            href={pr.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-medium text-slate-900 underline underline-offset-4"
                          >
                            <ExternalLink className="h-4 w-4" />
                            GitHub
                          </a>
                        ) : (
                          <ShieldCheck className="ml-auto h-4 w-4 text-slate-400" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

      </section>
    </main>
  )
}
