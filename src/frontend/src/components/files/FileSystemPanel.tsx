"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import Editor, { DiffEditor } from "@monaco-editor/react"
import { NodeRendererProps, Tree } from "react-arborist"
import {
  Braces,
  ChevronDown,
  ChevronRight,
  Code2,
  File,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  ImageIcon,
  Radio,
  RefreshCw,
  ScrollText,
  Settings2,
  Sheet,
  WifiOff,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { AgentCoreClient } from "@/lib/agentcore-client"
import type { SelectedRepository } from "@/lib/agentcore-client/types"
import type { PullRequestInfo } from "@/components/chat/types"
import {
  FileContent,
  FileEvent,
  FileEntry,
  getCachedFileContent,
  setCachedFileContent,
} from "@/services/fileEventsService"

const FILE_REFRESH_INTERVAL_MS = 30_000

type FileSystemPanelProps = {
  accessToken?: string | null
  client?: AgentCoreClient | null
  repository?: SelectedRepository | null
  sessionId?: string
  pullRequest?: PullRequestInfo | null
  onPullRequestChange?: (pullRequest: PullRequestInfo | null) => void
}

type FileChangeStatus = "added" | "modified" | "deleted" | "unchanged"

type FileDiff = {
  path: string
  status: FileChangeStatus
  originalContent: string
  currentContent: string
}

type ArboristFileNode = {
  id: string
  name: string
  path: string
  type: "directory" | "file"
  event?: FileEvent
  changeStatus?: FileChangeStatus
  children?: ArboristFileNode[]
}

type MutableTreeNode = {
  id: string
  name: string
  path: string
  type: "directory" | "file"
  children: Map<string, MutableTreeNode>
  event?: FileEvent
  changeStatus?: FileChangeStatus
}

function createMutableRoot(): MutableTreeNode {
  return { id: "", name: "", path: "", type: "directory", children: new Map() }
}

function upsertFile(
  root: MutableTreeNode,
  event: FileEvent,
  displayKey = event.key,
  changeStatus: FileChangeStatus = "unchanged"
) {
  const parts = displayKey.split("/").filter(Boolean)
  if (parts.length === 0) return

  let current = root
  parts.forEach((part, index) => {
    const path = parts.slice(0, index + 1).join("/")
    const isFile = index === parts.length - 1 && !displayKey.endsWith("/")
    const existing = current.children.get(part)
    const next =
      existing ??
      {
        id: path,
        name: part,
        path,
        type: isFile ? "file" : "directory",
        children: new Map<string, MutableTreeNode>(),
      }
    next.type = isFile ? "file" : "directory"
    if (isFile) {
      next.event = event
      next.changeStatus = changeStatus
    }
    current.children.set(part, next)
    current = next
  })
}

function removeFile(root: MutableTreeNode, key: string) {
  const parts = key.split("/").filter(Boolean)
  if (parts.length === 0) return

  const stack: Array<[MutableTreeNode, string]> = []
  let current = root
  for (const part of parts) {
    const next = current.children.get(part)
    if (!next) return
    stack.push([current, part])
    current = next
  }

  const last = stack.pop()
  if (!last) return
  last[0].children.delete(last[1])

  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const [parent, name] = stack[index]
    const child = parent.children.get(name)
    if (child && child.type === "directory" && child.children.size === 0) {
      parent.children.delete(name)
    }
  }
}

function sortedMutableChildren(node: MutableTreeNode) {
  return Array.from(node.children.values()).sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

function toArboristNode(node: MutableTreeNode): ArboristFileNode {
  return {
    id: node.id,
    name: node.name,
    path: node.path,
    type: node.type,
    event: node.event,
    changeStatus: node.changeStatus,
    children:
      node.type === "directory"
        ? sortedMutableChildren(node).map(child => toArboristNode(child))
        : undefined,
  }
}

function displayKeyForEvent(key: string, displayRootPrefixes: string[]) {
  for (const prefix of displayRootPrefixes) {
    if (prefix && key.startsWith(prefix)) return key.slice(prefix.length)
  }
  return displayRootPrefixes.length > 0 ? null : key
}

function buildTreeData(
  events: FileEvent[],
  displayRootPrefixes: string[] = [],
  fileStatusByPath: Map<string, FileChangeStatus> = new Map()
) {
  const root = createMutableRoot()
  for (const event of events) {
    const displayKey = displayKeyForEvent(event.key, displayRootPrefixes)
    if (!displayKey) continue
    if (event.eventName.startsWith("ObjectRemoved")) {
      removeFile(root, displayKey)
    } else {
      upsertFile(root, event, displayKey, fileStatusByPath.get(displayKey) ?? "unchanged")
    }
  }
  for (const [path, changeStatus] of fileStatusByPath) {
    if (changeStatus === "unchanged") continue
    upsertFile(
      root,
      {
        bucket: "",
        key: changeStatus === "deleted" ? path : `${displayRootPrefixes[0] ?? ""}${path}`,
        eventName: changeStatus === "deleted" ? "GitDeleted" : "GitChanged",
        eventTime: new Date(0).toISOString(),
      },
      path,
      changeStatus
    )
  }
  return sortedMutableChildren(root).map(node => toArboristNode(node))
}

function mergeFileEvents(current: FileEvent[], incoming: FileEvent[]) {
  const byKey = new Map<string, FileEvent>()
  for (const event of current) {
    if (event.eventName === "ObjectListed") byKey.set(event.key, event)
  }
  for (const event of incoming) {
    byKey.set(event.key, event)
  }
  return Array.from(byKey.values())
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(-1000)
}

function eventFromEntry(entry: FileEntry): FileEvent {
  return {
    bucket: "",
    key: entry.key,
    eventName: "ObjectListed",
    eventTime: entry.lastModified ?? new Date(0).toISOString(),
    size: entry.size,
    eTag: entry.eTag,
  }
}

function formatSize(size?: number | null) {
  if (size === undefined || size === null) return ""
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function languageFromKey(key?: string) {
  const extension = key?.split(".").pop()?.toLowerCase()
  switch (extension) {
    case "css":
      return "css"
    case "html":
      return "html"
    case "js":
    case "mjs":
    case "cjs":
      return "javascript"
    case "json":
      return "json"
    case "md":
    case "markdown":
      return "markdown"
    case "py":
      return "python"
    case "ts":
      return "typescript"
    case "tsx":
      return "typescript"
    case "yml":
    case "yaml":
      return "yaml"
    default:
      return "plaintext"
  }
}

function fileIconForName(name: string) {
  const lower = name.toLowerCase()
  const extension = lower.split(".").pop()
  if (["js", "jsx", "ts", "tsx", "mjs", "cjs"].includes(extension ?? "")) return FileCode2
  if (extension === "json") return FileJson
  if (["tf", "hcl"].includes(extension ?? "")) return Braces
  if (["md", "mdx", "txt"].includes(extension ?? "")) return FileText
  if (["yml", "yaml", "toml", "ini", "env"].includes(extension ?? "")) return Settings2
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension ?? "")) return ImageIcon
  if (["csv", "tsv", "xls", "xlsx"].includes(extension ?? "")) return Sheet
  if (["sh", "bash", "zsh", "ps1"].includes(extension ?? "")) return ScrollText
  if (["py", "go", "rs", "java", "rb", "php", "cs"].includes(extension ?? "")) return Code2
  return File
}

function statusLabel(status?: FileChangeStatus) {
  if (!status || status === "unchanged") return null
  if (status === "added") return "A"
  if (status === "modified") return "M"
  return "D"
}

function statusClassName(status?: FileChangeStatus) {
  switch (status) {
    case "added":
      return "border-emerald-200 bg-emerald-50 text-emerald-700"
    case "modified":
      return "border-amber-200 bg-amber-50 text-amber-700"
    case "deleted":
      return "border-red-200 bg-red-50 text-red-700"
    default:
      return ""
  }
}

function parseChangedFile(line: string): { path: string; status: FileChangeStatus } | null {
  if (!line.trim()) return null
  const code = line.slice(0, 2)
  const rawPath = line.slice(3).trim()
  const path = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop()?.trim() ?? rawPath : rawPath
  if (!path) return null
  if (code.includes("D")) return { path, status: "deleted" }
  if (code.includes("A") || code.includes("?")) return { path, status: "added" }
  return { path, status: "modified" }
}

function statusMapFromPreview(preview: any) {
  const map = new Map<string, FileChangeStatus>()
  const changedFiles = Array.isArray(preview?.changedFiles) ? preview.changedFiles : []
  for (const line of changedFiles) {
    const parsed = parseChangedFile(String(line))
    if (parsed) map.set(parsed.path, parsed.status)
  }
  return map
}

function filterChangedTreeData(nodes: ArboristFileNode[]): ArboristFileNode[] {
  return nodes
    .map(node => {
      if (node.type === "file") {
        return node.changeStatus && node.changeStatus !== "unchanged" ? node : null
      }
      const children = filterChangedTreeData(node.children ?? [])
      return children.length > 0 ? { ...node, children } : null
    })
    .filter((node): node is ArboristFileNode => Boolean(node))
}

function FileTreeNode({ node, style, dragHandle }: NodeRendererProps<ArboristFileNode>) {
  const item = node.data
  const isDirectory = item.type === "directory"
  const FileIcon = fileIconForName(item.name)
  const changeLabel = statusLabel(item.changeStatus)

  return (
    <div
      ref={dragHandle}
      className={cn(
        "flex min-w-0 cursor-pointer items-center gap-1 border-b border-transparent px-2 text-sm",
        node.isSelected ? "bg-slate-100 text-slate-950" : "text-slate-700 hover:bg-slate-50"
      )}
      style={style}
      title={item.path}
    >
      <span className="flex w-4 shrink-0 items-center justify-center">
        {isDirectory ? (
          node.isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
          )
        ) : null}
      </span>
      {isDirectory ? (
        <Folder className="h-4 w-4 shrink-0 text-sky-600" />
      ) : (
        <FileIcon className="h-4 w-4 shrink-0 text-slate-500" />
      )}
      <span className="truncate font-medium">{item.name}</span>
      {changeLabel && (
        <span
          className={cn(
            "ml-auto rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-none",
            statusClassName(item.changeStatus)
          )}
        >
          {changeLabel}
        </span>
      )}
      {!isDirectory && item.event?.size !== undefined && (
        <span className={cn("shrink-0 text-xs text-slate-400", changeLabel ? "" : "ml-auto")}>
          {formatSize(item.event.size)}
        </span>
      )}
    </div>
  )
}

function useElementSize() {
  const ref = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 320, height: 480 })

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const update = () => {
      setSize({
        width: Math.max(240, element.clientWidth),
        height: Math.max(240, element.clientHeight),
      })
    }
    update()

    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return { ref, size }
}

function workspacePrefixes(_sessionId?: string, _repository?: SelectedRepository | null) {
  return []
}

export function FileSystemPanel({
  accessToken,
  client,
  repository,
  sessionId,
  pullRequest,
  onPullRequestChange,
}: FileSystemPanelProps) {
  const { ref: treeContainerRef, size: treeSize } = useElementSize()
  const [events, setEvents] = useState<FileEvent[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [selectedDisplayPath, setSelectedDisplayPath] = useState<string | null>(null)
  const [preview, setPreview] = useState<FileContent | null>(null)
  const [fileDiff, setFileDiff] = useState<FileDiff | null>(null)
  const [prPreview, setPrPreview] = useState<any>(null)
  const [isPrDialogOpen, setIsPrDialogOpen] = useState(false)
  const [isPrLoading, setIsPrLoading] = useState(false)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [isDiffLoading, setIsDiffLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [status, setStatus] = useState<"loading" | "connected" | "disabled" | "error">("loading")
  const [error, setError] = useState<string | null>(null)
  const [fileStatusByPath, setFileStatusByPath] = useState<Map<string, FileChangeStatus>>(new Map())
  const [fileScope, setFileScope] = useState<"changes" | "all">("changes")
  const [fileView, setFileView] = useState<"diff" | "file">("diff")
  const [treePanePercent, setTreePanePercent] = useState(32)
  const changeStatusTimerRef = useRef<number | null>(null)
  const displayRootPrefixes = useMemo(() => workspacePrefixes(sessionId, repository), [repository, sessionId])
  const displayRootPrefixesKey = displayRootPrefixes.join("|")
  const treeData = useMemo(
    () => buildTreeData(events, displayRootPrefixes, fileStatusByPath),
    [displayRootPrefixes, events, fileStatusByPath]
  )
  const changedFileCount = useMemo(
    () => Array.from(fileStatusByPath.values()).filter(status => status !== "unchanged").length,
    [fileStatusByPath]
  )
  const visibleTreeData = useMemo(
    () => (fileScope === "changes" ? filterChangedTreeData(treeData) : treeData),
    [fileScope, treeData]
  )
  const selectedLanguage = languageFromKey(preview?.key ?? selectedKey ?? undefined)
  const selectedChangeStatus = selectedDisplayPath ? fileStatusByPath.get(selectedDisplayPath) ?? "unchanged" : "unchanged"

  useEffect(() => {
    setEvents([])
    setSelectedKey(null)
    setSelectedDisplayPath(null)
    setPreview(null)
    setFileDiff(null)
    setFileStatusByPath(new Map())
  }, [displayRootPrefixesKey])

  useEffect(() => {
    if (pullRequest?.number || pullRequest?.url) {
      setPrPreview((current: any) => ({ ...(current ?? {}), ...pullRequest }))
    }
  }, [pullRequest])

  const refreshChangeStatus = useCallback(async () => {
    if (!client || !repository || !sessionId || !accessToken) return
    try {
      const response = await client.githubAction(
        "previewPullRequest",
        sessionId,
        accessToken,
        repository
      )
      setFileStatusByPath(statusMapFromPreview((response as any)?.preview ?? response))
    } catch {
      setFileStatusByPath(new Map())
    }
  }, [accessToken, client, repository, sessionId])

  useEffect(() => {
    return () => {
      if (changeStatusTimerRef.current !== null) {
        window.clearTimeout(changeStatusTimerRef.current)
      }
    }
  }, [])

  const refreshFiles = useCallback(
    async (options: { showLoading?: boolean } = {}) => {
      if (!client || !accessToken || !sessionId) return

      if (options.showLoading) setIsRefreshing(true)
      try {
        const response = await client.filesystemAction(
          "listFiles",
          sessionId,
          accessToken,
          repository
        )
        const entries = (((response as any)?.files ?? []) as FileEntry[])
        setEvents(prev => mergeFileEvents(prev, entries.map(eventFromEntry)))
        setError(null)
        setStatus("connected")
        if (options.showLoading) void refreshChangeStatus()
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to list files")
        setStatus("error")
      } finally {
        if (options.showLoading) setIsRefreshing(false)
      }
    },
    [accessToken, client, refreshChangeStatus, repository, sessionId]
  )

  const openPullRequestPreview = useCallback(async () => {
    if (!client || !repository || !sessionId || !accessToken) return
    setIsPrLoading(true)
    setIsPrDialogOpen(true)
    try {
      const response = await client.githubAction(
        "previewPullRequest",
        sessionId,
        accessToken,
        repository
      )
      const preview = (response as any)?.preview ?? response
      setPrPreview(preview)
      if (preview?.number || preview?.url) onPullRequestChange?.(preview)
      setFileStatusByPath(statusMapFromPreview(preview))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to preview pull request")
      setPrPreview(null)
    } finally {
      setIsPrLoading(false)
    }
  }, [accessToken, client, onPullRequestChange, repository, sessionId])

  const viewPullRequest = useCallback(() => {
    const url = pullRequest?.url ?? prPreview?.url
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer")
      return
    }
    void openPullRequestPreview()
  }, [openPullRequestPreview, prPreview?.url, pullRequest?.url])

  const createPullRequest = useCallback(async () => {
    if (!client || !repository || !sessionId || !accessToken || !prPreview) return
    setIsPrLoading(true)
    try {
      const response = await client.githubAction(
        "createPullRequest",
        sessionId,
        accessToken,
        repository,
        { title: prPreview.title, body: prPreview.body }
      )
      const nextPullRequest = (response as any)?.pullRequest ?? response
      setPrPreview(nextPullRequest)
      onPullRequestChange?.(nextPullRequest)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create pull request")
    } finally {
      setIsPrLoading(false)
    }
  }, [accessToken, client, onPullRequestChange, prPreview, repository, sessionId])

  useEffect(() => {
    if (!client || !accessToken || !sessionId) {
      setStatus("disabled")
      return
    }

    setStatus("loading")
    void refreshFiles()
    void refreshChangeStatus()

    const refreshTimer = window.setInterval(() => {
      void refreshFiles()
    }, FILE_REFRESH_INTERVAL_MS)

    return () => {
      window.clearInterval(refreshTimer)
    }
  }, [accessToken, client, refreshChangeStatus, refreshFiles, sessionId])

  useEffect(() => {
    if (!client || !accessToken || !sessionId || !selectedKey) {
      setPreview(null)
      return
    }

    let cancelled = false
    const cachedFile = getCachedFileContent(sessionId, selectedKey)
    if (cachedFile) {
      setPreview(cachedFile)
      setIsPreviewLoading(false)
    } else {
      setIsPreviewLoading(true)
    }
    client.filesystemAction(
      "getFileContent",
      sessionId,
      accessToken,
      repository,
      { fileKey: selectedKey }
    )
      .then(response => {
        if (cancelled) return
        const file = (response as any)?.file as FileContent
        setCachedFileContent(sessionId, selectedKey, file)
        setPreview(file)
        setError(null)
      })
      .catch(err => {
        if (cancelled) return
        setPreview(null)
        setError(err instanceof Error ? err.message : "Failed to preview file")
      })
      .finally(() => {
        if (!cancelled) setIsPreviewLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [accessToken, client, repository, selectedKey, sessionId])

  useEffect(() => {
    if (!client || !repository || !sessionId || !accessToken || !selectedDisplayPath || selectedChangeStatus === "unchanged") {
      setFileDiff(null)
      return
    }

    let cancelled = false
    setIsDiffLoading(true)
    client.githubAction(
      "getFileDiff",
      sessionId,
      accessToken,
      repository,
      undefined,
      { filePath: selectedDisplayPath }
    )
      .then(response => {
        if (cancelled) return
        setFileDiff(((response as any)?.fileDiff ?? null) as FileDiff | null)
      })
      .catch(err => {
        if (cancelled) return
        setFileDiff(null)
        setError(err instanceof Error ? err.message : "Failed to load file diff")
      })
      .finally(() => {
        if (!cancelled) setIsDiffLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [accessToken, client, repository, selectedChangeStatus, selectedDisplayPath, sessionId])

  const handleTreeResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const container = event.currentTarget.parentElement
    if (!container) return
    const bounds = container.getBoundingClientRect()
    const move = (moveEvent: PointerEvent) => {
      const next = ((moveEvent.clientX - bounds.left) / bounds.width) * 100
      setTreePanePercent(Math.min(60, Math.max(22, next)))
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }, [])

  return (
    <aside className="flex h-full min-w-0 flex-col border-l border-slate-200 bg-white pb-36">
      <div className="flex items-center justify-end border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Button
            aria-label="Reload filesystem"
            className="h-8 w-8 p-0"
            disabled={!client || !accessToken || !sessionId || isRefreshing}
            onClick={() => {
              void refreshFiles({ showLoading: true })
              void refreshChangeStatus()
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          </Button>
          <Button
            disabled={!client || !repository || !accessToken || !sessionId || isPrLoading}
            onClick={viewPullRequest}
            size="sm"
            type="button"
            variant="outline"
          >
            View PR
          </Button>
          {status === "connected" ? (
            <Radio className="h-4 w-4 text-emerald-600" />
          ) : status === "loading" ? (
            <RefreshCw className="h-4 w-4 animate-spin text-slate-500" />
          ) : (
            <WifiOff className="h-4 w-4 text-amber-600" />
          )}
          <span className="capitalize">{status}</span>
        </div>
      </div>

      {error && (
        <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div
        className="grid min-h-0 flex-1"
        style={{ gridTemplateColumns: `${treePanePercent}% 6px minmax(0, 1fr)` }}
      >
        <div className="flex min-h-0 min-w-0 flex-col border-r border-slate-200">
          <div className="flex items-center gap-1 border-b border-slate-200 bg-slate-50 px-2 py-2">
            <Button
              className="h-7 px-2 text-xs"
              onClick={() => setFileScope("changes")}
              size="sm"
              type="button"
              variant={fileScope === "changes" ? "default" : "ghost"}
            >
              Changes ({changedFileCount})
            </Button>
            <Button
              className="h-7 px-2 text-xs"
              onClick={() => setFileScope("all")}
              size="sm"
              type="button"
              variant={fileScope === "all" ? "default" : "ghost"}
            >
              All Files
            </Button>
          </div>
          <div ref={treeContainerRef} className="min-h-0 flex-1">
            {visibleTreeData.length > 0 ? (
              <Tree
                data={visibleTreeData}
                disableDrag
                disableDrop
                disableEdit
                disableMultiSelection
                height={treeSize.height}
                indent={18}
                onActivate={node => {
                  if (node.data.type === "directory") {
                    node.toggle()
                    return
                  }
                  setSelectedKey(node.data.event?.eventName === "GitDeleted" ? null : node.data.event?.key ?? node.data.path)
                  setSelectedDisplayPath(node.data.path)
                  setFileView(node.data.changeStatus && node.data.changeStatus !== "unchanged" ? "diff" : "file")
                }}
                openByDefault
                rowHeight={32}
                selection={selectedDisplayPath ?? undefined}
                width={treeSize.width}
              >
                {FileTreeNode}
              </Tree>
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">
                {status === "disabled"
                  ? "Agent runtime filesystem is not connected."
                  : fileScope === "changes"
                    ? "No changes in this chat PR."
                    : "No files found yet."}
              </div>
            )}
          </div>
        </div>

        <div
          className="cursor-col-resize bg-slate-200 transition hover:bg-slate-300"
          role="separator"
          aria-orientation="vertical"
          onPointerDown={handleTreeResize}
        />

        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="flex min-h-10 items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <div className="truncate text-sm font-semibold text-slate-800">
                  {selectedDisplayPath ?? selectedKey ?? "Select a file"}
                </div>
                {statusLabel(selectedChangeStatus) && (
                  <span
                    className={cn(
                      "rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-none",
                      statusClassName(selectedChangeStatus)
                    )}
                  >
                    {selectedChangeStatus}
                  </span>
                )}
              </div>
              <div className="truncate text-xs text-slate-500">
                {fileDiff && selectedChangeStatus !== "unchanged"
                  ? `Diff against last commit · ${selectedChangeStatus}`
                  : preview
                  ? `${preview.encoding}${preview.size ? ` · ${formatSize(preview.size)}` : ""}`
                  : "Read-only preview"}
              </div>
            </div>
            {(isPreviewLoading || isDiffLoading) && <RefreshCw className="h-4 w-4 animate-spin text-slate-500" />}
            {selectedChangeStatus !== "unchanged" && (
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  className="h-7 px-2 text-xs"
                  onClick={() => setFileView("diff")}
                  size="sm"
                  type="button"
                  variant={fileView === "diff" ? "default" : "ghost"}
                >
                  Diff
                </Button>
                <Button
                  className="h-7 px-2 text-xs"
                  onClick={() => setFileView("file")}
                  size="sm"
                  type="button"
                  variant={fileView === "file" ? "default" : "ghost"}
                >
                  File
                </Button>
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1">
            {fileDiff && selectedChangeStatus !== "unchanged" && fileView === "diff" ? (
              <DiffEditor
                height="100%"
                language={selectedLanguage}
                modified={fileDiff.currentContent}
                original={fileDiff.originalContent}
                options={{
                  automaticLayout: true,
                  fontSize: 13,
                  minimap: { enabled: false },
                  readOnly: true,
                  renderSideBySide: true,
                  scrollBeyondLastLine: false,
                  wordWrap: "on",
                }}
                theme="vs"
              />
            ) : preview ? (
              <Editor
                height="100%"
                language={selectedLanguage}
                options={{
                  automaticLayout: true,
                  fontSize: 13,
                  minimap: { enabled: false },
                  readOnly: true,
                  scrollBeyondLastLine: false,
                  wordWrap: "on",
                }}
                theme="vs"
                value={preview.content}
              />
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">
                {isPreviewLoading ? "Loading preview..." : "Select a file to preview its content."}
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog open={isPrDialogOpen} onOpenChange={setIsPrDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Pull Request Preview</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded border bg-slate-50 p-3 text-sm">
            {isPrLoading ? (
              "Loading..."
            ) : prPreview?.created ? (
              <a className="text-sky-700 underline" href={prPreview.url} rel="noreferrer" target="_blank">
                Pull request #{prPreview.number}
              </a>
            ) : prPreview ? (
              <div className="flex flex-col gap-3">
                <div>
                  <div className="font-semibold">{prPreview.title}</div>
                  <div className="text-xs text-slate-500">
                    {prPreview.headBranch} → {prPreview.baseBranch}
                  </div>
                </div>
                <pre className="whitespace-pre-wrap text-xs">{prPreview.diffStat || "No diff stat"}</pre>
                <pre className="whitespace-pre-wrap text-xs">{prPreview.diff || "No tracked diff"}</pre>
                {prPreview.untrackedFiles?.length > 0 && (
                  <pre className="whitespace-pre-wrap text-xs">
                    Untracked files: {prPreview.untrackedFiles.join(", ")}
                  </pre>
                )}
              </div>
            ) : (
              "No preview loaded."
            )}
          </div>
          <DialogFooter>
            <Button
              disabled={isPrLoading || !prPreview?.hasChanges || prPreview?.created}
              onClick={() => void createPullRequest()}
            >
              Create Pull Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
