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

const fileContentCache = new Map<string, { file: FileContent; timestamp: number }>()

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
