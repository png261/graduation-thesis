import { describe, expect, it, vi } from "vitest"
import {
  getCachedFileContent,
  notifyFilesystemChanged,
  setCachedFileContent,
  subscribeFilesystemChanges,
} from "@/services/fileEventsService"

describe("fileEventsService realtime filesystem notifications", () => {
  it("notifies only listeners for the changed session and supports unsubscribe", () => {
    const sessionId = `session-${crypto.randomUUID()}`
    const otherSessionId = `session-${crypto.randomUUID()}`
    const listener = vi.fn()
    const otherListener = vi.fn()

    const unsubscribe = subscribeFilesystemChanges(sessionId, listener)
    subscribeFilesystemChanges(otherSessionId, otherListener)

    notifyFilesystemChanged({
      sessionId,
      paths: ["main.tf"],
      reason: "file_write",
    })

    expect(listener).toHaveBeenCalledWith({
      sessionId,
      paths: ["main.tf"],
      reason: "file_write",
    })
    expect(otherListener).not.toHaveBeenCalled()

    unsubscribe()
    notifyFilesystemChanged({ sessionId, paths: ["variables.tf"] })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("invalidates cached file previews when filesystem changes arrive", () => {
    const sessionId = `session-${crypto.randomUUID()}`
    setCachedFileContent(sessionId, "main.tf", {
      key: "main.tf",
      content: "old",
      encoding: "utf-8",
    })
    setCachedFileContent(sessionId, "variables.tf", {
      key: "variables.tf",
      content: "keep",
      encoding: "utf-8",
    })

    notifyFilesystemChanged({ sessionId, paths: ["main.tf"] })

    expect(getCachedFileContent(sessionId, "main.tf")).toBeNull()
    expect(getCachedFileContent(sessionId, "variables.tf")?.content).toBe("keep")

    notifyFilesystemChanged({ sessionId })
    expect(getCachedFileContent(sessionId, "variables.tf")).toBeNull()
  })
})
