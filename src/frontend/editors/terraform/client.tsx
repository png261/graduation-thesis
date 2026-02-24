import { useCallback, useEffect, useState, useRef } from "react";
import { toast } from "sonner";
import { CodeEditor } from "@/components/code-editor";
import {
  Console,
  type ConsoleOutput,
  type ConsoleOutputContent,
} from "@/components/console";
import { Editor } from "@/components/create-editor";
import {
  CopyIcon,
  CrossSmallIcon,
  FileIcon,
  LogsIcon,
  MessageIcon,
  TrashIcon,
} from "@/components/icons";
import {
  CodeIcon,
  MessageCircleIcon,
  PlayIcon,
  TerminalIcon,
  UndoIcon,
  RedoIcon,
  PlusIcon,
  FolderIcon,
  RefreshCcwIcon,
  DollarSignIcon,
  NetworkIcon,
  Settings2Icon,
} from "lucide-react";
import { cn, generateUUID } from "@/lib/utils";
import { ResizeHandle } from "@/components/resize-handle";
import { MonacoDiffEditor } from "@/components/monaco-diff-editor";
import { usePendingChanges } from "@/hooks/use-pending-changes";
import { type FileChange } from "@/lib/git-api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

type File = {
  title: string;
  content: string;
};

interface TreeItem {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeItem[];
  file?: File;
}

const TerraformIcon = ({ size = 16 }: { size?: number }) => (
  <svg
    fill="none"
    height={size}
    viewBox="0 0 32 32"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M21.1 11.2V3.4L28.9 7.8V15.6L21.1 11.2Z" fill="#5C4EE5" />
    <path d="M11 5.6V13.4L3.2 9V1.2L11 5.6Z" fill="#5C4EE5" />
    <path d="M21.1 22.1V14.3L28.9 18.7V26.5L21.1 22.1Z" fill="#5C4EE5" />
    <path d="M11 16.5V24.3L3.2 19.9V12.1L11 16.5Z" fill="#5C4EE5" />
    <path d="M21.1 11.2V3.4L13.3 7.8V15.6L21.1 11.2Z" fill="#4033C0" />
    <path
      d="M21.1 11.2L13.3 15.6L5.5 11.2L13.3 6.8L21.1 11.2Z"
      fill="#8479F1"
    />
    <path d="M21.1 22.1V14.3L13.3 18.7V26.5L21.1 22.1Z" fill="#4033C0" />
    <path d="M11 5.6V13.4L18.8 9V1.2L11 5.6Z" fill="#4033C0" />
    <path d="M11 16.5V24.3L18.8 19.9V12.1L11 16.5Z" fill="#4033C0" />
  </svg>
);

const MarkdownIcon = ({ size = 16 }: { size?: number }) => (
  <svg
    fill="none"
    height={size}
    viewBox="0 0 32 32"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M30 6H2C0.9 6 0 6.9 0 8V24C0 25.1 0.9 26 2 26H30C31.1 26 32 25.1 32 24V8C32 6.9 31.1 6 30 6ZM18 22H15V15L12 19L9 15V22H6V10H9L12 14L15 10H18V22ZM26 14V22H23V14H20L24.5 9L29 14H26Z"
      fill="#0080FF"
    />
  </svg>
);

const ChevronIcon = ({
  size = 12,
  isOpen = false,
}: {
  size?: number;
  isOpen?: boolean;
}) => (
  <svg
    className={cn(
      "transition-transform duration-200",
      isOpen ? "rotate-90" : "rotate-0"
    )}
    fill="none"
    height={size}
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    viewBox="0 0 24 24"
    width={size}
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

function buildTree(files: File[]): TreeItem[] {
  const root: TreeItem[] = [];

  files.forEach((file) => {
    const parts = file.title.split("/");
    let currentLevel = root;
    let currentPath = "";

    parts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isLast = index === parts.length - 1;

      let existing = currentLevel.find((item) => item.name === part);

      if (!existing) {
        existing = {
          name: part,
          path: currentPath,
          type: isLast ? "file" : "directory",
          children: isLast ? undefined : [],
          file: isLast ? file : undefined,
        };
        currentLevel.push(existing);
      }

      if (!isLast) {
        currentLevel = existing.children!;
      }
    });
  });

  const sortTree = (items: TreeItem[]) => {
    items.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    items.forEach((item) => {
      if (item.children) sortTree(item.children);
    });
  };

  sortTree(root);
  return root;
}

type Metadata = {
  outputs: ConsoleOutput[];
  activeFile?: string;
  openFiles?: string[];
  console?: ConsoleOutputContent;
};

function TreeItemNode({
  item,
  level,
  activeFile,
  expandedFolders,
  onToggleFolder,
  onOpenFile,
  onDelete,
}: {
  item: TreeItem;
  level: number;
  activeFile?: string;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onOpenFile: (file: File) => void;
  onDelete: (path: string, type: "file" | "directory") => void;
}) {
  const isOpen = expandedFolders.has(item.path);
  const isActive = activeFile === item.path;

  if (item.type === "directory") {
    return (
      <div className="relative group/folder">
        {/* Vertical guide line */}
        {level > 0 && isOpen && (
          <div
            className="absolute left-0 top-6 bottom-0 w-px bg-muted-foreground/10"
            style={{ left: `${level * 12 + 10}px` }}
          />
        )}
        <div className="flex items-center w-full pr-2 hover:bg-muted/50 transition-colors group">
          <button
            className="flex-grow flex items-center gap-1 py-1.5 px-2 text-sm text-muted-foreground/80 select-none"
            onClick={() => onToggleFolder(item.path)}
            style={{ paddingLeft: `${level * 12 + 4}px` }}
          >
            <ChevronIcon isOpen={isOpen} size={14} />
            <FolderIcon size={16} className="text-amber-500" />
            <span className="truncate">{item.name}</span>
          </button>
          <button
            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-muted rounded text-muted-foreground hover:text-red-500 transition-all"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(item.path, "directory");
            }}
            title="Delete Folder"
          >
            <TrashIcon size={12} />
          </button>
        </div>
        {isOpen &&
          item.children?.map((child) => (
            <TreeItemNode
              activeFile={activeFile}
              expandedFolders={expandedFolders}
              item={child}
              key={child.path}
              level={level + 1}
              onDelete={onDelete}
              onOpenFile={onOpenFile}
              onToggleFolder={onToggleFolder}
            />
          ))}
      </div>
    );
  }

  return (
    <div className="flex items-center w-full pr-2 group relative">
      <button
        className={cn(
          "flex-grow flex items-center gap-2 py-1.5 px-2 text-sm transition-colors",
          isActive
            ? "bg-primary/10 text-primary font-medium border-r-2 border-primary"
            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        )}
        onClick={() => onOpenFile(item.file!)}
        style={{ paddingLeft: `${level * 12 + 22}px` }} // 12px indent + chevron (14px) + gap
      >
        <span className="shrink-0">
          {item.name.endsWith(".tf") ? (
            <TerraformIcon size={14} />
          ) : item.name.endsWith(".md") ? (
            <MarkdownIcon size={14} />
          ) : (
            <FileIcon size={14} />
          )}
        </span>
        <span className="truncate">{item.name}</span>
        {item.file?.content === "Pending..." && (
          <span className="ml-auto w-1.5 h-1.5 bg-yellow-500 rounded-full animate-pulse" />
        )}
      </button>
      <button
        className="absolute right-1 opacity-0 group-hover:opacity-100 p-1 hover:bg-muted rounded text-muted-foreground hover:text-red-500 transition-all z-10 bg-background/80 backdrop-blur-sm"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(item.path, "file");
        }}
        title="Delete File"
      >
        <TrashIcon size={12} />
      </button>
    </div>
  );
}

function EnvironmentVariablesDialog({ chatId }: { chatId: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [envContent, setEnvContent] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen && chatId) {
      fetch(`/api/project/${chatId}/env`)
        .then((res) => res.json())
        .then((data) => {
          if (data.env !== undefined) {
            setEnvContent(data.env);
          }
        })
        .catch((err) => {
          console.error("Failed to load environment variables", err);
          toast.error("Failed to load environment variables");
        });
    }
  }, [isOpen, chatId]);

  const handleSave = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/project/${chatId}/env`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ env_content: envContent }),
      });
      if (!res.ok) throw new Error("Failed to save");
      toast.success("Environment variables saved");
      setIsOpen(false);
    } catch (err) {
      console.error(err);
      toast.error("Failed to save environment variables");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <button
          className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors"
          title="Environment Variables"
        >
          <Settings2Icon size={12} />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Environment Variables</DialogTitle>
        </DialogHeader>
        <div className="py-2">
          <p className="text-xs text-muted-foreground mb-3">
            Define environment variables here (e.g., AWS_ACCESS_KEY_ID, TF_VAR_instance_type).
            These are injected directly into the Terraform runtime block and are NOT tracked by Git.
          </p>
          <Textarea
            value={envContent}
            onChange={(e) => setEnvContent(e.target.value)}
            className="font-mono text-sm h-48"
            placeholder="AWS_ACCESS_KEY_ID=YOUR_KEY&#10;AWS_SECRET_ACCESS_KEY=YOUR_SECRET&#10;TF_VAR_region=us-east-1"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isLoading}>
            {isLoading ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TerraformEditorContent(
  props: any
) {
  const content = props.content;
  const [metadata, setMetadata] = useState<Metadata>(
    props.metadata || { outputs: [], activeFile: "main.tf", openFiles: ["main.tf"] }
  );
  const [files, setFiles] = useState<File[]>([{ title: "main.tf", content }]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Use the pending changes hook to get the actual file content diffs
  const { changes } = usePendingChanges(props.chatId);

  // We need to keep track of ALL file names we've seen in the current generated response
  // so we know which ones to add to the openFiles list when they are fully generated.
  const seenTitlesRef = useRef<Set<string>>(new Set());

  const tree = buildTree(files);

  const toggleFolder = (path: string) => {
    const next = new Set(expandedFolders);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setExpandedFolders(next);
  };

  // --- File Management Actions ---
  const chatId = props.chatId;

  const handleCreateFile = async () => {
    const path = window.prompt("Enter file path (e.g., modules/vpc/main.tf):");
    if (!path) return;

    if (files.some((f) => f.title === path)) {
      toast.error("File already exists");
      return;
    }

    // Optimistic update
    const newFile = { title: path, content: "" };
    const updatedFiles = [...files, newFile];
    setFiles(updatedFiles);
    setMetadata({
      ...(metadata || {}),
      activeFile: path,
      openFiles: [...((metadata?.openFiles) || []), path],
    });

    // Save to backend
    try {
      if (chatId) {
        await fetch(`/api/project/${chatId}/file`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path, content: "" }),
        });
        // Persist to DB via onSaveContent
        props.onSaveContent?.(JSON.stringify({ files: updatedFiles }), true);
        toast.success("File created");
      }
    } catch (e) {
      toast.error("Failed to create file on backend");
      console.error(e);
    }
  };

  const handleCreateFolder = async () => {
    const path = window.prompt("Enter folder name:");
    if (!path) return;

    // Backend only operation for now, as files array depends on files
    // But we can create the folder in backend
    try {
      if (chatId) {
        await fetch(`/api/project/${chatId}/folder`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path }),
        });
        toast.success("Folder created");
        // TODO: Maybe trigger a refresh or handle empty folder display?
      }
    } catch (e) {
      toast.error("Failed to create folder");
    }
  };

  const handleDelete = async (path: string, type: "file" | "directory") => {
    if (!confirm(`Are you sure you want to delete ${path}?`)) return;

    // Optimistic local update
    let updatedFiles = files;
    if (type === "file") {
      updatedFiles = files.filter((f) => f.title !== path);
    } else {
      updatedFiles = files.filter((f) => !f.title.startsWith(path + "/"));
    }
    setFiles(updatedFiles);

    // Close tab if active
    if (
      metadata?.activeFile === path ||
      (type === "directory" && metadata?.activeFile?.startsWith(path + "/"))
    ) {
      setMetadata({ ...(metadata || {}), activeFile: undefined });
    }

    // Save to backend
    try {
      if (chatId) {
        const endpoint = type === "file" ? "file" : "folder";
        await fetch(`/api/project/${chatId}/${endpoint}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path }),
        });
        props.onSaveContent?.(JSON.stringify({ files: updatedFiles }), true);
        toast.success(`${type === "file" ? "File" : "Folder"} deleted`);
      }
    } catch (e) {
      toast.error("Failed to delete on backend");
      console.error(e);
    }
  };

  const runSync = async (silent = false) => {
    if (!chatId) return;
    setIsSyncing(true);
    try {
      const res = await fetch(`/api/project/${chatId}/files`, {
        method: "GET",
      });
      const data = await res.json();
      if (data.files) {
        const backendFiles = Object.entries(data.files).map(([k, v]) => ({
          title: k,
          content: v as string,
        }));
        setFiles(backendFiles);
        if (!silent) toast.success("Synced with backend");
      }
    } catch (e) {
      if (!silent) toast.error("Sync failed");
    } finally {
      setIsSyncing(false);
    }
  };

  const openFile = (file: File) => {
    const openFiles = metadata?.openFiles || [];
    const nextOpenFiles = openFiles.includes(file.title)
      ? openFiles
      : [...openFiles, file.title];
    setMetadata({
      ...(metadata || {}),
      activeFile: file.title,
      openFiles: nextOpenFiles,
    });
  };

  // Auto-sync files on mount
  useEffect(() => {
    if (chatId && !isSyncing && !props.isGenerating) {
      runSync(true); // Silent sync on initial load
    }
  }, [chatId]); // We deliberately only want to trigger this on initial mount/chatid change

  useEffect(() => {
    if (!content) {
      return;
    }

    const trimmedContent = content.trim();

    // Robust JSON parsing for partial/malformed strings during streaming
    const parseJson = (str: string) => {
      try {
        return JSON.parse(str);
      } catch (e) {
        // Try to close common brackets if it's a partial JSON string
        const suffixes = ["}", '"}', "]}", '"]}', '"]}', '"]}]}', '"} ] }'];
        for (const suffix of suffixes) {
          try {
            return JSON.parse(str + suffix);
          } catch { }
        }
        return null;
      }
    };

    // 1. Try to parse as the dynamic JSON structure
    if (trimmedContent.startsWith("{")) {
      console.log(
        "[TerraformClient] Parsing JSON content, length:",
        trimmedContent.length
      );
      const parsed = parseJson(trimmedContent);
      console.log("[TerraformClient] Parsed result:", parsed);
      if (parsed && parsed.files && Array.isArray(parsed.files)) {
        console.log(
          "[TerraformClient] Setting files:",
          parsed.files.length,
          "files"
        );
        setFiles(parsed.files);

        // Identify truly new files that should be auto-opened
        const incomingTitles = parsed.files.map((f: any) => f.title);
        const newlyDiscoveredTitles = incomingTitles.filter(
          (t: string) => !seenTitlesRef.current.has(t)
        );

        // Track all titles we've ever seen in this session
        incomingTitles.forEach((t: string) => seenTitlesRef.current.add(t));

        const currentOpenFiles = metadata?.openFiles || [];
        const updates: Partial<Metadata> = {};

        if (!metadata?.activeFile && parsed.files.length > 0) {
          updates.activeFile = parsed.files[0].title;
        }

        // Only add newly discovered files to openFiles
        // This prevents closed tabs from being re-added on every stream update
        if (newlyDiscoveredTitles.length > 0 || !metadata?.openFiles) {
          updates.openFiles = [
            ...new Set([...currentOpenFiles, ...newlyDiscoveredTitles]),
          ];
        }

        if (Object.keys(updates).length > 0) {
          setMetadata({ ...(metadata || {}), ...updates });
        }

        setParseError(null);
        return;
      }

      // Heuristic for partial/streaming content if full parse fails
      const titles = [
        ...trimmedContent.matchAll(/"title"\s*:\s*"([^"]+)"/g),
      ].map((m: any) => m[1]);
      if (titles.length > 0) {
        // Identify truly new files that should be auto-opened
        const newlyDiscoveredTitles = titles.filter(
          (t: string) => !seenTitlesRef.current.has(t)
        );

        // Track all titles we've ever seen in this session
        titles.forEach((t: string) => seenTitlesRef.current.add(t));

        // Update files if titles changed or we need to show progress
        const updatedFiles = titles.map((t: string) => {
          // Try to extract content for this title if it exists in the raw string
          const contentMatch = trimmedContent.match(
            new RegExp(`"title"\\s*:\\s*"${t}"[^}]+"content"\\s*:\\s*"([^"]*)`)
          );
          const existingFile = files.find((f) => f.title === t);
          return {
            title: t,
            content:
              contentMatch && contentMatch[1] !== undefined
                ? contentMatch[1].replace(/\\n/g, "\n")
                : existingFile?.content || "Generating...",
          };
        });
        setFiles(updatedFiles);

        const updates: Partial<Metadata> = {};
        if (!metadata?.activeFile) {
          updates.activeFile = titles[0];
        }

        // Only add newly discovered files to openFiles
        if (newlyDiscoveredTitles.length > 0 || !metadata?.openFiles) {
          const currentOpenFiles = metadata?.openFiles || [];
          updates.openFiles = [
            ...new Set([...currentOpenFiles, ...newlyDiscoveredTitles]),
          ];
        }

        if (Object.keys(updates).length > 0) {
          setMetadata({ ...(metadata || {}), ...updates });
        }
      }
    } else if (trimmedContent.length > 0) {
      // 2. Fallback for legacy or raw HCL content
      setFiles([{ title: "main.tf", content }]);
      if (!metadata?.activeFile) {
        setMetadata({ ...(metadata || {}), activeFile: "main.tf" });
      }
      setParseError(null);
    }
  }, [content, metadata?.activeFile]);

  const activeFile =
    files.find((f) => f.title === metadata?.activeFile) || files[0];
  const isGenerating =
    props.isGenerating ||
    activeFile?.content === "" ||
    activeFile?.content === "Generating..." ||
    (activeFile?.content?.length < 10 && activeFile?.content !== "Pending...");
  const isPending = activeFile?.content === "Pending...";
  const [isSyncing, setIsSyncing] = useState(false);
  const [mainTab, setMainTab] = useState<"code" | "costs" | "graph">("code");
  const [explorerWidth, setExplorerWidth] = useState(224);

  const handleExplorerResize = useCallback(
    (delta: number) => {
      setExplorerWidth((prev) => Math.min(400, Math.max(120, prev + delta)));
    },
    []
  );

  return (
    <div className="flex h-full bg-background overflow-hidden">
      {/* Sidebar with tabs inside */}
      <div style={{ width: `${explorerWidth}px` }} className="border-r bg-muted/10 flex flex-col shrink-0">
        {/* Tabs inside sidebar */}
        <div className="flex items-center border-b bg-muted/20 shrink-0">
          <button
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-xs font-medium transition-colors",
              mainTab === "code"
                ? "bg-background text-foreground border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
            )}
            onClick={() => setMainTab("code")}
          >
            <CodeIcon size={12} />
            Code
          </button>
          <button
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-xs font-medium transition-colors",
              mainTab === "costs"
                ? "bg-background text-foreground border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
            )}
            onClick={() => setMainTab("costs")}
          >
            <DollarSignIcon size={12} />
            Costs
          </button>
          <button
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-xs font-medium transition-colors",
              mainTab === "graph"
                ? "bg-background text-foreground border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
            )}
            onClick={() => setMainTab("graph")}
          >
            <NetworkIcon size={12} />
            Graph
          </button>
        </div>

        {/* Tab-specific sidebar content */}
        {mainTab === "code" && (
          <>
            <div className="px-3 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest border-b bg-muted/20 flex items-center justify-between">
              <span>Explorer</span>
              <div className="flex items-center gap-1">
                <button
                  className="p-1 hover:bg-muted rounded transition-colors"
                  onClick={handleCreateFile}
                  title="New File"
                >
                  <PlusIcon size={12} />
                </button>
                <button
                  className="p-1 hover:bg-muted rounded transition-colors"
                  onClick={handleCreateFolder}
                  title="New Folder"
                >
                  <FolderIcon size={12} />
                </button>
                <button
                  className="p-1 hover:bg-muted rounded transition-colors"
                  onClick={() => runSync()}
                  title="Sync from Backend"
                >
                  <RefreshCcwIcon size={12} className={isSyncing ? "animate-spin" : ""} />
                </button>
                <button
                  className="p-1 hover:bg-muted rounded transition-colors"
                  onClick={() => setExpandedFolders(new Set())}
                  title="Collapse All"
                >
                  <LogsIcon size={12} />
                </button>
                <EnvironmentVariablesDialog chatId={chatId} />
              </div>
            </div>
            <div className="flex-grow overflow-y-auto py-2 custom-scrollbar">
              {tree.map((item) => (
                <TreeItemNode
                  activeFile={metadata?.activeFile}
                  expandedFolders={expandedFolders}
                  item={item}
                  key={item.path}
                  level={0}
                  onDelete={handleDelete}
                  onOpenFile={openFile}
                  onToggleFolder={toggleFolder}
                />
              ))}
              {files.length === 0 && (
                <div className="px-4 py-8 text-center text-xs text-muted-foreground italic">
                  Initializing project...
                </div>
              )}
            </div>
          </>
        )}

        {mainTab === "costs" && (
          <div className="p-4 flex-1 overflow-auto">
            <h3 className="text-base font-bold mb-4">Cost Summary</h3>
            <div className="rounded-md border border-muted bg-muted/20 p-3 mb-4">
              <p className="text-sm text-muted-foreground">
                No environments detected in your configuration.
              </p>
            </div>
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <span className="mt-0.5 shrink-0">ℹ</span>
              <p>Costs are calculated using your Terraform configuration.</p>
            </div>
          </div>
        )}

        {mainTab === "graph" && (
          <div className="p-4 flex-1 overflow-auto">
            <h3 className="text-base font-bold mb-4">Graph View</h3>
            <div className="rounded-md border border-muted bg-muted/20 p-3 mb-4">
              <p className="text-sm text-muted-foreground">
                No environments detected in your configuration.
              </p>
            </div>
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <span className="mt-0.5 shrink-0">ℹ</span>
              <p>The graph is rendered using your Terraform configuration.</p>
            </div>
          </div>
        )}
      </div>

      <ResizeHandle direction="horizontal" onResize={handleExplorerResize} />

      {/* Main Content Area (Right) */}
      {mainTab === "code" && (
        <div className="flex-grow flex flex-col overflow-hidden min-w-0">
          {/* Tabs Bar */}
          <div className="flex items-center justify-between px-2 py-1 border-b bg-muted/30">
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar max-w-full">
              {(metadata?.openFiles || []).map((title: string) => {
                const file = files.find((f) => f.title === title);
                if (!file) return null;
                return (
                  <div
                    className={cn(
                      "group flex items-center gap-1 px-3 py-1.5 text-sm font-medium border-r border-muted whitespace-nowrap transition-colors relative",
                      metadata?.activeFile === file.title
                        ? "bg-background text-foreground"
                        : "hover:bg-muted/50 text-muted-foreground bg-muted/20"
                    )}
                    key={file.title}
                  >
                    {metadata?.activeFile === file.title && (
                      <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary" />
                    )}
                    <button
                      className="flex items-center gap-2"
                      onClick={() =>
                        setMetadata({ ...(metadata || {}), activeFile: file.title })
                      }
                    >
                      <span className="shrink-0">
                        {file.title.endsWith(".tf") ? (
                          <TerraformIcon size={12} />
                        ) : file.title.endsWith(".md") ? (
                          <MarkdownIcon size={12} />
                        ) : (
                          <FileIcon size={12} />
                        )}
                      </span>
                      <span className="truncate max-w-[120px]">
                        {file.title.split("/").pop()}
                      </span>
                    </button>
                    <button
                      className={cn(
                        "ml-1 p-0.5 rounded hover:bg-muted transition-opacity",
                        metadata?.activeFile === file.title
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100"
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        const newOpenFiles = (metadata?.openFiles || []).filter(
                          (t: string) => t !== file.title
                        );
                        let newActiveFile = metadata?.activeFile;
                        if (newActiveFile === file.title) {
                          newActiveFile = newOpenFiles[0] || undefined;
                        }
                        setMetadata({
                          ...(metadata || {}),
                          openFiles: newOpenFiles,
                          activeFile: newActiveFile,
                        });
                      }}
                    >
                      <CrossSmallIcon size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Editor Area */}
          <div className="flex-grow flex flex-col overflow-hidden relative">
            {activeFile ? (
              <div className="h-full pt-2 px-1 overflow-y-auto custom-scrollbar">
                {isPending && changes.find((c: FileChange) => c.filePath === activeFile.title) ? (
                  <MonacoDiffEditor
                    originalContent={changes.find((c: FileChange) => c.filePath === activeFile.title)?.oldContent || ""}
                    modifiedContent={changes.find((c: FileChange) => c.filePath === activeFile.title)?.newContent || activeFile.content}
                    language="hcl"
                  />
                ) : (
                  <CodeEditor
                    {...props}
                    content={
                      isGenerating
                        ? activeFile.content || "Generating content..."
                        : activeFile.content || ""
                    }
                    onSaveContent={(newValue: string) => {
                      if (!activeFile || isGenerating) return;
                      setIsSyncing(true);
                      const updatedFiles = files.map((f: File) =>
                        f.title === activeFile.title
                          ? { ...f, content: newValue || "" }
                          : f
                      );
                      props.onSaveContent?.(
                        JSON.stringify({ files: updatedFiles }),
                        true
                      );

                      // Save to backend
                      if (props.chatId) {
                        fetch(`/api/project/${props.chatId}/file`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            path: activeFile.title,
                            content: newValue || "",
                          }),
                        }).catch((e) => console.error("Auto-save failed:", e));
                      }

                      // Reset syncing state after a short delay
                      setTimeout(() => setIsSyncing(false), 500);
                    }}
                    status={isGenerating ? "streaming" : "idle"}
                  />
                )}
              </div>
            ) : (
              <div className="p-10 flex flex-col items-center justify-center text-muted-foreground h-full text-center">
                <div className="opacity-20 mb-4">
                  <FileIcon size={48} />
                </div>
                <p>No files open.</p>
                <p className="text-sm">
                  Select a file from the sidebar to open it.
                </p>
              </div>
            )}

            {metadata?.outputs && metadata.outputs.length > 0 && (
              <div className="absolute bottom-0 left-0 right-0 z-50">
                <Console
                  consoleOutputs={metadata.outputs}
                  setConsoleOutputs={() => {
                    setMetadata({
                      ...metadata,
                      outputs: [],
                    });
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {mainTab === "costs" && (
        <div className="flex-grow flex flex-col overflow-hidden min-w-0 bg-muted/20">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-muted">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Resource</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Quantity</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Units</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Monthly Cost</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-muted/50">
                <td className="px-4 py-3 font-medium">Total</td>
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3 text-right">$0.00</td>
              </tr>
            </tbody>
          </table>
          <div className="px-4 py-3 flex items-start gap-2 text-xs text-muted-foreground border-t border-muted">
            <span className="mt-0.5">⚠</span>
            <p>
              Not all Terraform resources are supported for cost analysis.
              View our <a href="https://www.infracost.io/docs/" target="_blank" rel="noreferrer" className="underline hover:text-foreground">docs</a> for a full list of what is supported.
            </p>
          </div>
        </div>
      )}

      {mainTab === "graph" && (
        <div className="flex-grow flex flex-col overflow-hidden min-w-0 relative bg-muted/10 dark:bg-zinc-900/80 [background-image:radial-gradient(circle,_rgba(0,0,0,0.06)_1px,_transparent_1px)] dark:[background-image:radial-gradient(circle,_rgba(255,255,255,0.08)_1px,_transparent_1px)] [background-size:24px_24px]">
          {/* View mode toggles */}
          <div className="absolute top-3 right-3 flex items-center bg-muted/30 rounded-lg border border-muted">
            <button className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground rounded-l-lg transition-colors">
              Detailed
            </button>
            <button className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
              Category
            </button>
            <button className="px-3 py-1.5 text-xs font-medium bg-background text-foreground border-l border-r border-muted rounded-r-lg transition-colors">
              Architecture
            </button>
          </div>

          {/* Zoom controls */}
          <div className="absolute bottom-3 left-3 flex flex-col bg-muted/30 rounded-lg border border-muted">
            <button className="px-2 py-1.5 text-sm font-bold text-muted-foreground hover:text-foreground border-b border-muted transition-colors">+</button>
            <button className="px-2 py-1.5 text-sm font-bold text-muted-foreground hover:text-foreground border-b border-muted transition-colors">−</button>
            <button className="px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">⟲</button>
          </div>
        </div>
      )}
    </div>
  );
}

export const terraformEditor = new Editor<"terraform", Metadata>({
  kind: "terraform",
  description: "Generate and manage Terraform infrastructure code.",
  initialize: ({ setMetadata }) => {
    setMetadata({
      outputs: [],
      activeFile: "main.tf",
      openFiles: ["main.tf"],
    });
  },
  onStreamPart: ({ streamPart, setEditor }) => {
    if (streamPart.type === "data-terraformDelta") {
      setEditor((draftEditor: any) => ({
        ...draftEditor,
        content: streamPart.data,
        isVisible: true,
        status: "streaming",
      }));
    }
  },
  content: TerraformEditorContent,
  actions: [
    {
      icon: <TerminalIcon size={18} />,
      label: "Plan",
      description: "Run Terraform Plan",
      onClick: async ({ content, metadata, setMetadata, chatId }) => {
        // chatId
        const runId = generateUUID();
        setMetadata((metadata) => ({
          ...metadata,
          outputs: [
            ...metadata.outputs,
            {
              id: runId,
              contents: [],
              status: "in_progress",
            },
          ],
        }));

        try {
          let filesMap: Record<string, string> = {};
          try {
            const parsed = JSON.parse(content);
            if (parsed.files && Array.isArray(parsed.files)) {
              parsed.files.forEach((f: any) => {
                filesMap[f.title] = f.content;
              });
            } else {
              filesMap = { "main.tf": content };
            }
          } catch (e) {
            filesMap = { "main.tf": content };
          }

          const response = await fetch("/api/terraform/plan", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              files: filesMap,
              chatId,
            }),
          });

          const result = await response.json();

          if (!response.ok) {
            throw new Error(result.detail || "Failed to run terraform plan");
          }

          const outputContent: ConsoleOutputContent[] = [
            { type: "text", value: result.output || "No output" },
          ];

          setMetadata((metadata) => ({
            ...metadata,
            outputs: [
              ...metadata.outputs.filter((output) => output.id !== runId),
              {
                id: runId,
                contents: outputContent,
                status: "completed",
              },
            ],
          }));
        } catch (error: any) {
          setMetadata((metadata) => ({
            ...metadata,
            outputs: [
              ...metadata.outputs.filter((output) => output.id !== runId),
              {
                id: runId,
                contents: [{ type: "text", value: error.message }],
                status: "failed",
              },
            ],
          }));
        }
      },
    },
    {
      icon: <PlayIcon size={18} />,
      label: "Apply",
      description: "Run Terraform Apply",
      onClick: async ({ content, metadata, setMetadata, chatId }) => {
        // chatId
        const runId = generateUUID();
        setMetadata((metadata) => ({
          ...metadata,
          outputs: [
            ...metadata.outputs,
            {
              id: runId,
              contents: [],
              status: "in_progress",
            },
          ],
        }));

        try {
          let filesMap: Record<string, string> = {};
          try {
            const parsed = JSON.parse(content);
            if (parsed.files && Array.isArray(parsed.files)) {
              parsed.files.forEach((f: any) => {
                filesMap[f.title] = f.content;
              });
            } else {
              filesMap = { "main.tf": content };
            }
          } catch (e) {
            filesMap = { "main.tf": content };
          }

          const response = await fetch("/api/terraform/apply", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              files: filesMap,
              chatId,
            }),
          });

          const result = await response.json();

          if (!response.ok) {
            throw new Error(result.detail || "Failed to run terraform apply");
          }

          const outputContent: ConsoleOutputContent[] = [
            { type: "text", value: result.output || "No output" },
          ];

          setMetadata((metadata) => ({
            ...metadata,
            outputs: [
              ...metadata.outputs.filter((output) => output.id !== runId),
              {
                id: runId,
                contents: outputContent,
                status: "completed",
              },
            ],
          }));
        } catch (error: any) {
          setMetadata((metadata) => ({
            ...metadata,
            outputs: [
              ...metadata.outputs.filter((output) => output.id !== runId),
              {
                id: runId,
                contents: [{ type: "text", value: error.message }],
                status: "failed",
              },
            ],
          }));
        }
      },
    },
    {
      icon: <UndoIcon size={18} />,
      description: "View Previous version",
      onClick: ({ handleVersionChange }) => {
        handleVersionChange("prev");
      },
      isDisabled: ({ currentVersionIndex }) => {
        return currentVersionIndex === 0;
      },
    },
    {
      icon: <RedoIcon size={18} />,
      description: "View Next version",
      onClick: ({ handleVersionChange }) => {
        handleVersionChange("next");
      },
      isDisabled: ({ isCurrentVersion }) => {
        return isCurrentVersion;
      },
    },
    {
      icon: <CopyIcon size={18} />,
      description: "Copy code to clipboard",
      onClick: ({ content }) => {
        navigator.clipboard.writeText(content);
        toast.success("Copied to clipboard!");
      },
    },
  ],
  toolbar: [],
});
