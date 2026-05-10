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
  HardDrive,
  ImageIcon,
  Radio,
  RefreshCw,
  ScrollText,
  Settings2,
  Sheet,
  WifiOff,
} from "lucide-react"
import { useAuth } from "react-oidc-context"
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
import {
  FileContent,
  FileEvent,
  FileEntry,
  getFileContent,
  listFileEntries,
  subscribeToFileEvents,
} from "@/services/fileEventsService"

const FILE_REFRESH_INTERVAL_MS = 10_000

type AwsExports = {
  fileEventsApiUrl?: string | null
  sharedBrainBucketName?: string | null
  sharedBrainMountPath?: string | null
}

type FileSystemPanelProps = {
  accessToken?: string | null
  client?: AgentCoreClient | null
  repository?: SelectedRepository | null
  sessionId?: string
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
    if (changeStatus !== "deleted") continue
    upsertFile(
      root,
      {
        bucket: "",
        key: path,
        eventName: "GitDeleted",
        eventTime: new Date(0).toISOString(),
      },
      path,
      changeStatus
    )
  }
  return sortedMutableChildren(root).map(node => toArboristNode(node))
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

function sessionRootPrefix(sessionId?: string) {
  return sessionId ? `shared/workspace/sessions/${sessionId}/` : ""
}

function legacySessionRootPrefix(sessionId?: string) {
  return sessionId ? `shared/workspace/workspace/sessions/${sessionId}/` : ""
}

function workspacePrefixes(sessionId?: string, repository?: SelectedRepository | null) {
  const root = sessionRootPrefix(sessionId)
  if (!root || !repository) return []
  const legacyRoot = legacySessionRootPrefix(sessionId)
  return [
    `${root}repos/${repository.owner}/${repository.name}/`,
    `${legacyRoot}repos/${repository.owner}/${repository.name}/`,
  ]
}

export function FileSystemPanel({
  accessToken,
  client,
  repository,
  sessionId,
}: FileSystemPanelProps) {
  const auth = useAuth()
  const { ref: treeContainerRef, size: treeSize } = useElementSize()
  const [config, setConfig] = useState<AwsExports | null>(null)
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
  const [treePanePercent, setTreePanePercent] = useState(32)
  const displayRootPrefixes = useMemo(() => workspacePrefixes(sessionId, repository), [repository, sessionId])
  const displayRootPrefixesKey = displayRootPrefixes.join("|")
  const treeData = useMemo(
    () => buildTreeData(events, displayRootPrefixes, fileStatusByPath),
    [displayRootPrefixes, events, fileStatusByPath]
  )
  const lastEvent = events[events.length - 1]
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

  const refreshFiles = useCallback(
    async (options: { showLoading?: boolean } = {}) => {
      const apiUrl = config?.fileEventsApiUrl
      const token = auth.user?.id_token
      if (!apiUrl || !token || !sessionId || !repository) return

      if (options.showLoading) setIsRefreshing(true)
      try {
        const entries = (await Promise.all(
          displayRootPrefixes.map(prefix => listFileEntries(apiUrl, token, prefix))
        )).flat()
        setEvents(prev =>
          [
            ...entries.map(eventFromEntry),
            ...prev.filter(event => event.eventName !== "ObjectListed"),
          ].slice(-500)
        )
        setError(null)
        setStatus("connected")
        void refreshChangeStatus()
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to list files")
        setStatus("error")
      } finally {
        if (options.showLoading) setIsRefreshing(false)
      }
    },
    [auth.user?.id_token, config?.fileEventsApiUrl, displayRootPrefixes, refreshChangeStatus, repository, sessionId]
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
      setPrPreview((response as any)?.preview ?? response)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to preview pull request")
      setPrPreview(null)
    } finally {
      setIsPrLoading(false)
    }
  }, [accessToken, client, repository, sessionId])

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
      setPrPreview((response as any)?.pullRequest ?? response)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create pull request")
    } finally {
      setIsPrLoading(false)
    }
  }, [accessToken, client, prPreview, repository, sessionId])

  useEffect(() => {
    let cancelled = false
    fetch("/aws-exports.json")
      .then(response => (response.ok ? response.json() : Promise.reject(response.statusText)))
      .then((loaded: AwsExports) => {
        if (cancelled) return
        setConfig(loaded)
        setStatus(loaded.fileEventsApiUrl ? "loading" : "disabled")
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : "Failed to load file event config")
        setStatus("error")
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const apiUrl = config?.fileEventsApiUrl
    const token = auth.user?.id_token
    if (!apiUrl || !token || !sessionId || !repository) return

    setStatus("loading")
    void refreshFiles()
    void refreshChangeStatus()

    const refreshTimer = window.setInterval(() => {
      void refreshFiles()
      void refreshChangeStatus()
    }, FILE_REFRESH_INTERVAL_MS)

    const unsubscribe = subscribeToFileEvents(
      apiUrl,
      token,
      event => {
        setEvents(prev => [...prev, event].slice(-500))
        setError(null)
        setStatus("connected")
      },
      err => {
        setError(err.message)
        setStatus("error")
      }
    )

    return () => {
      window.clearInterval(refreshTimer)
      unsubscribe()
    }
  }, [auth.user?.id_token, config?.fileEventsApiUrl, refreshChangeStatus, refreshFiles, repository, sessionId])

  useEffect(() => {
    const apiUrl = config?.fileEventsApiUrl
    const token = auth.user?.id_token
    if (!apiUrl || !token || !selectedKey) {
      setPreview(null)
      return
    }

    let cancelled = false
    setIsPreviewLoading(true)
    getFileContent(apiUrl, token, selectedKey)
      .then(file => {
        if (cancelled) return
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
  }, [auth.user?.id_token, config?.fileEventsApiUrl, selectedKey])

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
    <aside className="flex h-full min-w-0 flex-col border-l border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <HardDrive className="h-5 w-5 text-slate-700" />
            <h2 className="truncate text-base font-semibold text-slate-900">AgentCore Files</h2>
          </div>
          <p className="mt-1 truncate text-xs text-slate-500">
            {config?.sharedBrainMountPath ?? "/mnt/s3"}
            {config?.sharedBrainBucketName ? ` · ${config.sharedBrainBucketName}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Button
            aria-label="Reload filesystem"
            className="h-8 w-8 p-0"
            disabled={!config?.fileEventsApiUrl || !auth.user?.id_token || isRefreshing}
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
            onClick={() => void openPullRequestPreview()}
            size="sm"
            type="button"
            variant="outline"
          >
            Create Pull Request
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
          <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Files
          </div>
          <div ref={treeContainerRef} className="min-h-0 flex-1">
            {treeData.length > 0 ? (
              <Tree
                data={treeData}
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
                  ? "File event subscription is not configured."
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
          </div>

          <div className="min-h-0 flex-1">
            {fileDiff && selectedChangeStatus !== "unchanged" ? (
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

      <div className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
        {lastEvent
          ? `${lastEvent.eventName}: ${lastEvent.key}`
          : repository
            ? `Waiting for changes in ${repository.fullName}`
            : "Set up a GitHub repository to browse files"}
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
