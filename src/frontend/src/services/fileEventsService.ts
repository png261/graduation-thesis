export type FileEvent = {
  bucket: string
  key: string
  eventName: string
  eventTime: string
  size?: number | null
  eTag?: string | null
  sequencer?: string | null
}

export type FileEntry = {
  key: string
  size?: number | null
  lastModified?: string | null
  eTag?: string | null
}

export type FileContent = {
  key: string
  content: string
  contentType?: string | null
  encoding: "utf-8" | "base64"
  size?: number | null
  lastModified?: string | null
}

export type FilesystemChangeEvent = {
  sessionId: string
  paths?: string[]
  reason?: string
}

type FilesystemChangeListener = (event: FilesystemChangeEvent) => void

const fileContentCache = new Map<string, { file: FileContent; timestamp: number }>()
const filesystemChangeListeners = new Map<string, Set<FilesystemChangeListener>>()

function fileContentCacheKey(sessionId: string, key: string) {
  return `${sessionId}::${key}`
}

export function getCachedFileContent(sessionId: string, key: string): FileContent | null {
  return fileContentCache.get(fileContentCacheKey(sessionId, key))?.file ?? null
}

export function setCachedFileContent(sessionId: string, key: string, file: FileContent) {
  fileContentCache.set(fileContentCacheKey(sessionId, key), { file, timestamp: Date.now() })
}

export function invalidateCachedFileContent(sessionId: string, key: string) {
  fileContentCache.delete(fileContentCacheKey(sessionId, key))
}

export function clearCachedFileContentForSession(sessionId: string) {
  const prefix = `${sessionId}::`
  for (const key of fileContentCache.keys()) {
    if (key.startsWith(prefix)) fileContentCache.delete(key)
  }
}

export function subscribeFilesystemChanges(sessionId: string, listener: FilesystemChangeListener) {
  const listeners = filesystemChangeListeners.get(sessionId) ?? new Set<FilesystemChangeListener>()
  listeners.add(listener)
  filesystemChangeListeners.set(sessionId, listeners)

  return () => {
    const current = filesystemChangeListeners.get(sessionId)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) filesystemChangeListeners.delete(sessionId)
  }
}

export function notifyFilesystemChanged(event: FilesystemChangeEvent) {
  const paths = event.paths?.filter(Boolean)
  if (paths?.length) {
    for (const path of paths) invalidateCachedFileContent(event.sessionId, path)
  } else {
    clearCachedFileContentForSession(event.sessionId)
  }

  const listeners = filesystemChangeListeners.get(event.sessionId)
  if (!listeners) return
  for (const listener of Array.from(listeners)) {
    listener({ ...event, paths })
  }
}
