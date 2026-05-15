"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  Clock3,
  ExternalLink,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  SmilePlus,
  type LucideIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { InstalledRepositoryCombobox } from "@/components/github/InstalledRepositoryCombobox"
import { useAuth } from "@/hooks/useAuth"
import { useInstalledRepositories } from "@/hooks/useInstalledRepositories"
import type { ChatSession } from "@/components/chat/types"
import type { SelectedRepository } from "@/lib/agentcore-client/types"
import type { GitHubPullRequestStatus } from "@/services/resourcesService"
import { useWebAppStore } from "@/stores/webAppStore"

type PullRequestState = "open" | "closed" | "merged" | "all"

function formatDate(value?: string): string {
  if (!value) return "-"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function statusTone(status?: string): string {
  const normalized = (status || "").toLowerCase()
  if (["success", "completed", "merged", "open"].includes(normalized)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700"
  }
  if (["closed", "failure", "error", "timed_out", "cancelled", "action_required"].includes(normalized)) {
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

function reactionTotal(pr: GitHubPullRequestStatus): number {
  return pr.reactions?.total ?? 0
}

function displayState(pr: GitHubPullRequestStatus): "open" | "merged" | "closed" {
  if (pr.merged || pr.state === "merged") return "merged"
  if (pr.state === "closed") return "closed"
  return "open"
}

function prCheckState(pr: GitHubPullRequestStatus): string {
  return pr.checkConclusion || pr.checkStatus || pr.combinedStatus || "unknown"
}

function pullRequestChatSession(pr: GitHubPullRequestStatus, sessions: ChatSession[]): ChatSession | undefined {
  return sessions.find(session => {
    const sessionPr = session.pullRequest
    if (!sessionPr?.number) return false
    if (Number(sessionPr.number) !== Number(pr.number)) return false
    return session.repository?.fullName === pr.repository || sessionPr.url === pr.url
  })
}

type TimelineItem = {
  label: string
  value?: string
  tone?: string
}

function timelineItems(pr: GitHubPullRequestStatus): TimelineItem[] {
  const items: TimelineItem[] = [
    { label: "Created", value: pr.createdAt },
    { label: "Last webhook", value: pr.lastAction || pr.lastEvent ? `${pr.lastEvent || "event"} ${pr.lastAction || ""}`.trim() : "" },
    { label: "Checks", value: prCheckState(pr), tone: prCheckState(pr) },
  ]
  if (displayState(pr) === "merged") {
    items.push({ label: "Merged", value: pr.mergedAt, tone: "merged" })
  } else if (displayState(pr) === "closed") {
    items.push({ label: "Closed", value: pr.closedAt || pr.githubUpdatedAt, tone: "closed" })
  } else {
    items.push({ label: "Updated", value: pr.githubUpdatedAt || pr.updatedAt })
  }
  return items
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string
  value: number
  icon: LucideIcon
  tone: string
}) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
        </div>
        <span className={`rounded-md border p-2 ${tone}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </div>
  )
}

export default function PullRequestsPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const persistedRepository = useWebAppStore(state => state.selectedRepository)
  const pullRequestsByKey = useWebAppStore(state => state.pullRequestsByKey)
  const sessions = useWebAppStore(state => state.sessions)
  const hydrateUserConfig = useWebAppStore(state => state.hydrateUserConfig)
  const hydrateChatSessions = useWebAppStore(state => state.hydrateChatSessions)
  const setActiveSessionId = useWebAppStore(state => state.setActiveSessionId)
  const persistSelectedRepository = useWebAppStore(state => state.persistSelectedRepository)
  const loadPullRequestsFromStore = useWebAppStore(state => state.loadPullRequests)
  const {
    repositories,
    isLoading: isLoadingRepositories,
    error: repositoriesError,
  } = useInstalledRepositories(auth.user?.access_token)
  const [repository, setRepository] = useState(() => persistedRepository?.fullName ?? "")
  const [state, setState] = useState<PullRequestState>("all")
  const [pullRequests, setPullRequests] = useState<GitHubPullRequestStatus[]>(() => {
    const key = persistedRepository?.fullName ? `${persistedRepository.fullName}::all` : ""
    return key ? useWebAppStore.getState().pullRequestsByKey[key]?.items ?? [] : []
  })
  const [isLoading, setIsLoading] = useState(false)
  const [isConfigLoaded, setIsConfigLoaded] = useState(() => Boolean(persistedRepository))
  const [error, setError] = useState<string | null>(null)

  const displayedPullRequests = useMemo(
    () => pullRequests.filter(pr => state === "all" || displayState(pr) === state),
    [pullRequests, state]
  )

  const summary = useMemo(() => {
    const open = pullRequests.filter(pr => displayState(pr) === "open").length
    const merged = pullRequests.filter(pr => displayState(pr) === "merged").length
    const closed = pullRequests.filter(pr => displayState(pr) === "closed").length
    const reactions = pullRequests.reduce((total, pr) => total + reactionTotal(pr), 0)
    return { open, merged, closed, reactions }
  }, [pullRequests])

  const loadPullRequests = useCallback(async (force = false) => {
    const idToken = auth.user?.id_token
    if (!idToken || !repository || !repositories.some(item => item.fullName === repository)) return
    setIsLoading(true)
    setError(null)
    try {
      setPullRequests(await loadPullRequestsFromStore(repository, "all", idToken, { force }))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pull requests")
    } finally {
      setIsLoading(false)
    }
  }, [auth.user?.id_token, loadPullRequestsFromStore, repositories, repository])

  useEffect(() => {
    const cached = pullRequestsByKey[`${repository}::all`]
    if (cached) {
      setPullRequests(cached.items)
      return
    }
    void loadPullRequests()
  }, [loadPullRequests, pullRequestsByKey, repository])

  useEffect(() => {
    const idToken = auth.user?.id_token
    if (!idToken) return
    void hydrateChatSessions(idToken).catch(err =>
      setError(err instanceof Error ? err.message : "Failed to load chat sessions")
    )
    if (persistedRepository) {
      setRepository(current => current || persistedRepository.fullName)
      setIsConfigLoaded(true)
      return
    }
    let cancelled = false
    hydrateUserConfig(idToken)
      .then(() => {
        if (cancelled) return
        const selected = useWebAppStore.getState().selectedRepository
        if (selected?.fullName) setRepository(selected.fullName)
        setIsConfigLoaded(true)
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : "Failed to load user config")
        setIsConfigLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [auth.user?.id_token, hydrateChatSessions, hydrateUserConfig, persistedRepository])

  useEffect(() => {
    if (!isConfigLoaded) return
    if (repositories.length === 0) return
    if (repositories.some(item => item.fullName === repository)) return
    selectRepository(repositories[0])
  }, [isConfigLoaded, repositories, repository])

  function selectRepository(next: SelectedRepository) {
    setRepository(next.fullName)
    setPullRequests([])
    setError(null)
    const idToken = auth.user?.id_token
    if (idToken) {
      void persistSelectedRepository(next, idToken).catch(err =>
        setError(err instanceof Error ? err.message : "Failed to save user config")
      )
    }
  }

  function viewChat(session: ChatSession) {
    setActiveSessionId(session.id)
    navigate("/")
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Pull Requests</h1>
          <p className="mt-1 text-sm text-slate-500">
            GitHub bot-created pull requests with status, activity, reactions, and source chat links.
          </p>
        </div>
        <Button
          onClick={() => void loadPullRequests(true)}
          variant="outline"
          disabled={!repository || isLoading}
          className="gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          {isLoading ? "Loading" : "Reload"}
        </Button>
      </header>

      <section className="mx-auto flex max-w-7xl flex-col gap-4 p-6">
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
                <option value="all">All</option>
                <option value="open">Open</option>
                <option value="merged">Merged</option>
                <option value="closed">Closed</option>
              </select>
            </label>
          </div>
          {repository && (
            <p className="mt-3 flex items-center gap-2 text-sm text-slate-500">
              <GitBranch className="h-4 w-4" />
              Reading pull request records for {repository}
            </p>
          )}
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            label="Open"
            value={summary.open}
            icon={GitPullRequest}
            tone="border-emerald-200 bg-emerald-50 text-emerald-700"
          />
          <SummaryCard
            label="Merged"
            value={summary.merged}
            icon={GitMerge}
            tone="border-violet-200 bg-violet-50 text-violet-700"
          />
          <SummaryCard
            label="Closed"
            value={summary.closed}
            icon={GitPullRequestClosed}
            tone="border-red-200 bg-red-50 text-red-700"
          />
          <SummaryCard
            label="Reactions"
            value={summary.reactions}
            icon={SmilePlus}
            tone="border-sky-200 bg-sky-50 text-sky-700"
          />
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
              <h2 className="text-base font-semibold text-slate-900">Pull Request Timeline</h2>
              <p className="mt-1 text-sm text-slate-500">
                Showing {state === "all" ? "all" : state} GitHub bot-created pull request records.
              </p>
            </div>
            <span className="rounded-md border bg-slate-50 px-2 py-1 text-xs text-slate-600">
              {displayedPullRequests.length} of {pullRequests.length} pull requests
            </span>
          </div>

          {displayedPullRequests.length === 0 ? (
            <p className="p-5 text-sm text-slate-500">
              No GitHub bot-created pull request records found for this repository yet.
            </p>
          ) : (
            <div className="divide-y">
              {displayedPullRequests.map(pr => {
                const chatSession = pullRequestChatSession(pr, sessions)
                return (
                  <article key={`${pr.repository}-${pr.number}`} className="p-5 hover:bg-slate-50">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge value={displayState(pr)} />
                          {pr.draft && <StatusBadge value="draft" />}
                          <StatusBadge value={prCheckState(pr)} />
                        </div>
                        <h3 className="mt-3 text-base font-semibold text-slate-950">
                          #{pr.number} {pr.title}
                        </h3>
                        <p className="mt-1 text-sm text-slate-500">
                          {pr.author || "unknown author"} opened {formatDate(pr.createdAt)}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-600">
                          <span className="font-mono">{pr.headBranch || "-"}</span>
                          <span>into</span>
                          <span className="font-mono">{pr.baseBranch || "-"}</span>
                          <span>{pr.changedFiles ?? 0} files</span>
                          <span>+{pr.additions ?? 0}</span>
                          <span>-{pr.deletions ?? 0}</span>
                          <span>{pr.comments ?? 0} comments</span>
                          <span>{reactionTotal(pr)} reactions</span>
                        </div>
                        {pr.labels && pr.labels.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-1">
                            {pr.labels.map(label => (
                              <span key={label} className="rounded border bg-white px-2 py-0.5 text-xs text-slate-600">
                                {label}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-2 lg:justify-end">
                        {pr.url && (
                          <Button asChild variant="outline" size="sm">
                            <a href={pr.url} target="_blank" rel="noreferrer">
                              <ExternalLink className="h-4 w-4" />
                              View PR
                            </a>
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!chatSession}
                          onClick={() => chatSession && viewChat(chatSession)}
                        >
                          <MessageSquare className="h-4 w-4" />
                          View chat
                        </Button>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-3 md:grid-cols-4">
                      {timelineItems(pr).map(item => (
                        <div key={item.label} className="rounded-md border bg-white p-3">
                          <p className="flex items-center gap-2 text-xs font-medium uppercase text-slate-500">
                            <Clock3 className="h-3.5 w-3.5" />
                            {item.label}
                          </p>
                          <p className="mt-2 text-sm text-slate-800">
                            {item.label === "Checks" ? (
                              <StatusBadge value={item.value} />
                            ) : item.label === "Last webhook" ? (
                              item.value || "-"
                            ) : (
                              formatDate(item.value)
                            )}
                          </p>
                        </div>
                      ))}
                    </div>

                    {!chatSession && (
                      <p className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        No saved local chat session matches this pull request yet.
                      </p>
                    )}
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </section>
    </main>
  )
}
