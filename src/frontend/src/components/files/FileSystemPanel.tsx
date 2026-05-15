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
  RefreshCw,
  ScrollText,
  Settings2,
  Sheet,
  Workflow,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { AgentCoreClient } from "@/lib/agentcore-client"
import type { SelectedRepository, SelectedStateBackend } from "@/lib/agentcore-client/types"
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
  stateBackend?: SelectedStateBackend | null
  sessionId?: string
}

type FileChangeStatus = "added" | "modified" | "deleted" | "unchanged"

type FileDiff = {
  path: string
  status: FileChangeStatus
  originalContent: string
  currentContent: string
}

type TerraformGraphNode = {
  data?: {
    id?: string
    label?: string
    type?: string
    parent?: string
    change?: string
  }
  classes?: string
}

type TerraformGraphEdge = {
  data?: {
    id?: string
    source?: string
    target?: string
  }
}

type TerraformGraph = {
  terraformPath?: string
  tool?: string
  summary?: Record<string, number>
  graph?: {
    nodes?: TerraformGraphNode[]
    edges?: TerraformGraphEdge[]
  }
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

export function parseChangedFile(line: string): { path: string; status: FileChangeStatus } | null {
  const value = line.trim()
  if (!value) return null

  let code = ""
  let rawPath = value
  const tabParts = value.split("\t").filter(Boolean)
  const porcelainMatch = /^(.{1,2})\s+(.+)$/.exec(value)
  if (tabParts.length >= 2 && /^[ MADRCU?!]{1,3}\d*$/.test(tabParts[0])) {
    code = tabParts[0]
    rawPath = tabParts[tabParts.length - 1]
  } else if (porcelainMatch && /^[ MADRCU?!]{1,3}\d*$/.test(porcelainMatch[1])) {
    code = porcelainMatch[1]
    rawPath = porcelainMatch[2]
  }

  const path = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop()?.trim() ?? rawPath : rawPath.trim()
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

function graphNodeLabel(node: TerraformGraphNode) {
  return node.data?.label || node.data?.id?.split(".").pop() || node.data?.id || "resource"
}

function graphNodeClass(node: TerraformGraphNode) {
  return node.data?.change || node.classes || node.data?.type || "resource"
}

function graphNodeClassName(node: TerraformGraphNode) {
  const className = graphNodeClass(node)
  if (className.includes("create")) return "fill-emerald-50 stroke-emerald-500"
  if (className.includes("delete")) return "fill-red-50 stroke-red-500"
  if (className.includes("replace")) return "fill-violet-50 stroke-violet-500"
  if (className.includes("update")) return "fill-amber-50 stroke-amber-500"
  if (className.includes("data")) return "fill-pink-50 stroke-pink-500"
  if (className.includes("output")) return "fill-yellow-50 stroke-yellow-500"
  if (className.includes("module")) return "fill-indigo-50 stroke-indigo-500"
  return "fill-slate-50 stroke-slate-400"
}

function graphSummaryItems(summary?: Record<string, number>) {
  return [
    ["create", summary?.create ?? 0],
    ["update", summary?.update ?? 0],
    ["replace", summary?.replace ?? 0],
    ["delete", summary?.delete ?? 0],
    ["total", summary?.total ?? 0],
  ] as const
}

function formatTerraformGraphError(message: string): string {
  if (
    message.includes("UnauthorizedOperation") ||
    message.includes("AccessDenied") ||
    /Describe[A-Za-z]+/.test(message)
  ) {
    return [
      "Terraform could access the selected state backend, but the AWS provider still needs read permissions to run plan.",
      "Grant the selected AWS credential permissions for the provider data sources/resources shown in the error, then run plan again.",
      message,
    ].join("\n\n")
  }
  return message
}

function layoutGraph(nodes: TerraformGraphNode[], edges: TerraformGraphEdge[]) {
  const visibleNodes = nodes.filter(node => node.data?.id && !node.data.parent)
  const ids = new Set(visibleNodes.map(node => node.data?.id as string))
  const incoming = new Map<string, number>()
  const outgoing = new Map<string, string[]>()
  for (const node of visibleNodes) {
    const id = node.data?.id as string
    incoming.set(id, 0)
    outgoing.set(id, [])
  }
  for (const edge of edges) {
    const source = edge.data?.source
    const target = edge.data?.target
    if (!source || !target || !ids.has(source) || !ids.has(target)) continue
    outgoing.get(source)?.push(target)
    incoming.set(target, (incoming.get(target) ?? 0) + 1)
  }

  const levels = new Map<string, number>()
  const queue = visibleNodes
    .map(node => node.data?.id as string)
    .filter(id => (incoming.get(id) ?? 0) === 0)
  if (queue.length === 0) queue.push(...visibleNodes.map(node => node.data?.id as string).slice(0, 1))

  while (queue.length > 0) {
    const id = queue.shift() as string
    const currentLevel = levels.get(id) ?? 0
    for (const target of outgoing.get(id) ?? []) {
      levels.set(target, Math.max(levels.get(target) ?? 0, currentLevel + 1))
      incoming.set(target, Math.max(0, (incoming.get(target) ?? 0) - 1))
      if ((incoming.get(target) ?? 0) === 0) queue.push(target)
    }
  }
  for (const node of visibleNodes) {
    const id = node.data?.id as string
    if (!levels.has(id)) levels.set(id, 0)
  }

  const grouped = new Map<number, TerraformGraphNode[]>()
  for (const node of visibleNodes) {
    const id = node.data?.id as string
    const level = levels.get(id) ?? 0
    grouped.set(level, [...(grouped.get(level) ?? []), node])
  }

  const levelCount = Math.max(1, grouped.size)
  const maxRows = Math.max(1, ...Array.from(grouped.values()).map(group => group.length))
  const width = Math.max(760, levelCount * 230)
  const height = Math.max(420, maxRows * 104 + 80)
  const positioned = new Map<string, { node: TerraformGraphNode; x: number; y: number }>()
  for (const [level, group] of grouped) {
    group.forEach((node, index) => {
      const id = node.data?.id as string
      const gap = height / (group.length + 1)
      positioned.set(id, {
        node,
        x: 110 + level * 230,
        y: Math.max(56, gap * (index + 1)),
      })
    })
  }

  const visibleEdges = edges.filter(edge => {
    const source = edge.data?.source
    const target = edge.data?.target
    return Boolean(source && target && positioned.has(source) && positioned.has(target))
  })

  return { width, height, nodes: Array.from(positioned.values()), edges: visibleEdges, positioned }
}

function TerraformGraphPreview({ graph }: { graph: TerraformGraph | null }) {
  const nodes = graph?.graph?.nodes ?? []
  const edges = graph?.graph?.edges ?? []
  const layout = useMemo(() => layoutGraph(nodes, edges), [edges, nodes])

  if (!graph) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">
        Run plan to generate the graph.
      </div>
    )
  }

  if (layout.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">
        Terraform plan returned no graphable resources.
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto bg-white">
      <div className="sticky top-0 z-10 flex flex-wrap gap-2 border-b border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
        {graphSummaryItems(graph.summary).map(([label, value]) => (
          <span key={label} className="rounded border border-slate-200 px-2 py-1">
            {label}: {value}
          </span>
        ))}
      </div>
      <svg
        className="min-h-full min-w-full"
        height={layout.height}
        role="img"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width={layout.width}
      >
        <defs>
          <marker id="terraform-graph-arrow" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
            <path d="M0,0 L8,4 L0,8 z" fill="#64748b" />
          </marker>
        </defs>
        {layout.edges.map(edge => {
          const source = layout.positioned.get(edge.data?.source ?? "")
          const target = layout.positioned.get(edge.data?.target ?? "")
          if (!source || !target) return null
          const path = `M ${source.x + 78} ${source.y} C ${source.x + 142} ${source.y}, ${target.x - 142} ${target.y}, ${target.x - 78} ${target.y}`
          return (
            <path
              className="fill-none stroke-slate-400"
              d={path}
              key={edge.data?.id ?? `${edge.data?.source}-${edge.data?.target}`}
              markerEnd="url(#terraform-graph-arrow)"
              strokeWidth="1.5"
            />
          )
        })}
        {layout.nodes.map(({ node, x, y }) => (
          <g key={node.data?.id} transform={`translate(${x - 78} ${y - 26})`}>
            <rect className={cn("stroke-2", graphNodeClassName(node))} height="52" rx="6" width="156" />
            <text className="fill-slate-900 text-[12px] font-semibold" textAnchor="middle" x="78" y="23">
              {graphNodeLabel(node).slice(0, 24)}
            </text>
            <text className="fill-slate-500 text-[10px]" textAnchor="middle" x="78" y="39">
              {graphNodeClass(node).slice(0, 22)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
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
        node.isSelected ? "bg-slate-100 text-slate-950" : "text-slate-700 hover:bg-slate-50/80"
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
  stateBackend,
  sessionId,
}: FileSystemPanelProps) {
  const { ref: treeContainerRef, size: treeSize } = useElementSize()
  const [events, setEvents] = useState<FileEvent[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [selectedDisplayPath, setSelectedDisplayPath] = useState<string | null>(null)
  const [preview, setPreview] = useState<FileContent | null>(null)
  const [fileDiff, setFileDiff] = useState<FileDiff | null>(null)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [isDiffLoading, setIsDiffLoading] = useState(false)
  const [isGraphLoading, setIsGraphLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [status, setStatus] = useState<"loading" | "connected" | "disabled" | "error">("loading")
  const [error, setError] = useState<string | null>(null)
  const [graphError, setGraphError] = useState<string | null>(null)
  const [terraformGraph, setTerraformGraph] = useState<TerraformGraph | null>(null)
  const [fileStatusByPath, setFileStatusByPath] = useState<Map<string, FileChangeStatus>>(new Map())
  const [fileScope, setFileScope] = useState<"changes" | "all">("changes")
  const [fileView, setFileView] = useState<"diff" | "file" | "graph">("diff")
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
    setTerraformGraph(null)
    setGraphError(null)
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

  const refreshTerraformGraph = useCallback(async () => {
    if (!client || !repository || !sessionId || !accessToken) return
    setIsGraphLoading(true)
    setGraphError(null)
    setFileView("graph")
    try {
      const response = await client.githubAction(
        "generateTerraformGraph",
        sessionId,
        accessToken,
        repository,
        undefined,
        { terraformPath: ".", stateBackend }
      )
      setTerraformGraph(((response as any)?.terraformGraph ?? null) as TerraformGraph | null)
      setError(null)
    } catch (err) {
      const message = formatTerraformGraphError(
        err instanceof Error ? err.message : "Failed to generate Terraform graph"
      )
      setGraphError(message)
      setError(message)
    } finally {
      setIsGraphLoading(false)
    }
  }, [accessToken, client, repository, sessionId, stateBackend])

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
    <aside className="flex h-full min-w-0 flex-col border-l border-slate-200 bg-white">
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
          <div className="flex items-center gap-1 border-b border-slate-200 bg-white px-2 py-2">
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
            <Button
              aria-label="Reload filesystem"
              className="ml-auto h-7 w-7 p-0"
              disabled={!client || !accessToken || !sessionId || isRefreshing}
              onClick={() => {
                void refreshFiles({ showLoading: true })
                void refreshChangeStatus()
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
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
          <div className="flex min-h-10 items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 py-2">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <div className="truncate text-sm font-semibold text-slate-800">
                  {fileView === "graph" ? "Terraform graph" : selectedDisplayPath ?? selectedKey ?? "Select a file"}
                </div>
                {fileView !== "graph" && statusLabel(selectedChangeStatus) && (
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
                {fileView === "graph"
                  ? `${terraformGraph?.tool ?? "rover"}${terraformGraph?.summary?.total !== undefined ? ` · ${terraformGraph.summary.total} planned resources` : ""}`
                  : fileDiff && selectedChangeStatus !== "unchanged"
                  ? `Diff against last commit · ${selectedChangeStatus}`
                  : preview
                  ? `${preview.encoding}${preview.size ? ` · ${formatSize(preview.size)}` : ""}`
                  : "Read-only preview"}
              </div>
            </div>
            {(isPreviewLoading || isDiffLoading || isGraphLoading) && <RefreshCw className="h-4 w-4 animate-spin text-slate-500" />}
            <div className="flex shrink-0 items-center gap-1">
              {selectedChangeStatus !== "unchanged" && (
                <>
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
                </>
              )}
              <Button
                className="h-7 px-2 text-xs"
                onClick={() => {
                  setFileView("graph")
                  if (!terraformGraph && !isGraphLoading) void refreshTerraformGraph()
                }}
                size="sm"
                type="button"
                variant={fileView === "graph" ? "default" : "ghost"}
              >
                <Workflow className="mr-1 h-3.5 w-3.5" />
                Graph
              </Button>
              {fileView === "graph" && (
                <Button
                  className="h-7 px-2 text-xs"
                  disabled={!client || !repository || !accessToken || !sessionId || isGraphLoading}
                  onClick={() => void refreshTerraformGraph()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <RefreshCw className={cn("mr-1 h-3.5 w-3.5", isGraphLoading && "animate-spin")} />
                  Run plan
                </Button>
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1">
            {fileView === "graph" ? (
              graphError ? (
                <div className="flex h-full whitespace-pre-line items-center justify-center px-6 text-center text-sm text-red-700">
                  {graphError}
                </div>
              ) : isGraphLoading && !terraformGraph ? (
                <div className="flex h-full items-center justify-center gap-2 px-6 text-center text-sm text-slate-500">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Running terraform plan...
                </div>
              ) : (
                <TerraformGraphPreview graph={terraformGraph} />
              )
            ) : fileDiff && selectedChangeStatus !== "unchanged" && fileView === "diff" ? (
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
    </aside>
  )
}
