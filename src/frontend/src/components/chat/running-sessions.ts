import { useSyncExternalStore } from "react"

export type RunningSessions = Record<string, boolean>
type RunningSessionsListener = () => void

const runningSessionIds = new Set<string>()
const abortControllers = new Map<string, AbortController | null>()
const listeners = new Set<RunningSessionsListener>()
let snapshot: RunningSessions = {}

function buildSnapshot(): RunningSessions {
  return Object.fromEntries([...runningSessionIds].map(id => [id, true]))
}

function notifyRunningSessions() {
  snapshot = buildSnapshot()
  for (const listener of listeners) {
    listener()
  }
}

function subscribeRunningSessions(listener: RunningSessionsListener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useRunningSessions() {
  return useSyncExternalStore(subscribeRunningSessions, () => snapshot, () => snapshot)
}

export function registerRunningSession(sessionId: string, abortController: AbortController | null = null) {
  runningSessionIds.add(sessionId)
  abortControllers.set(sessionId, abortController)
  notifyRunningSessions()
}

export function unregisterRunningSession(sessionId: string) {
  runningSessionIds.delete(sessionId)
  abortControllers.delete(sessionId)
  notifyRunningSessions()
}

export function abortRunningSession(sessionId: string) {
  const abortController = abortControllers.get(sessionId)
  if (!abortController) return false
  abortController.abort()
  return true
}

export function hasRunningSessionController(sessionId: string) {
  return Boolean(abortControllers.get(sessionId))
}

export function isSessionRunning(sessionId: string) {
  return runningSessionIds.has(sessionId)
}

export function reconcileRunningSessions(sessionIds: string[]) {
  const nextIds = new Set(sessionIds)
  let changed = false

  for (const sessionId of abortControllers.keys()) {
    if (!nextIds.has(sessionId)) {
      abortControllers.delete(sessionId)
      changed = true
    }
  }

  for (const sessionId of runningSessionIds) {
    if (!nextIds.has(sessionId)) {
      runningSessionIds.delete(sessionId)
      changed = true
    }
  }

  for (const sessionId of nextIds) {
    if (!runningSessionIds.has(sessionId)) {
      runningSessionIds.add(sessionId)
      abortControllers.set(sessionId, null)
      changed = true
    }
  }

  if (changed) notifyRunningSessions()
}
