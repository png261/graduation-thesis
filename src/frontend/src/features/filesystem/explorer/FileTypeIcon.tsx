import {
  FileArchive,
  FileCode,
  FileCog,
  FileImage,
  FileJson,
  FileText,
  FileType,
  FileVideo,
  type LucideIcon,
  Terminal,
} from "lucide-react";

const CODE_EXTENSIONS = ["ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "rb", "php", "c", "cpp", "h"];
const DATA_EXTENSIONS = ["json", "yaml", "yml", "toml"];
const CONFIG_EXTENSIONS = ["tf", "hcl", "env", "ini", "conf", "config"];
const TEXT_EXTENSIONS = ["md", "txt", "rst"];
const SHELL_EXTENSIONS = ["sh", "bash", "zsh", "ps1"];
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"];
const VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "mkv"];
const ARCHIVE_EXTENSIONS = ["zip", "tar", "gz", "rar", "7z"];
const MARKUP_EXTENSIONS = ["html", "css", "scss", "less"];

type IconGroup = { extensions: string[]; icon: LucideIcon; className: string };

const ICON_GROUPS: IconGroup[] = [
  { extensions: CODE_EXTENSIONS, icon: FileCode, className: "h-3.5 w-3.5 shrink-0 text-sky-300" },
  { extensions: DATA_EXTENSIONS, icon: FileJson, className: "h-3.5 w-3.5 shrink-0 text-emerald-300" },
  { extensions: CONFIG_EXTENSIONS, icon: FileCog, className: "h-3.5 w-3.5 shrink-0 text-violet-300" },
  { extensions: TEXT_EXTENSIONS, icon: FileText, className: "h-3.5 w-3.5 shrink-0 text-amber-300" },
  { extensions: SHELL_EXTENSIONS, icon: Terminal, className: "h-3.5 w-3.5 shrink-0 text-lime-300" },
  { extensions: IMAGE_EXTENSIONS, icon: FileImage, className: "h-3.5 w-3.5 shrink-0 text-pink-300" },
  { extensions: VIDEO_EXTENSIONS, icon: FileVideo, className: "h-3.5 w-3.5 shrink-0 text-fuchsia-300" },
  { extensions: ARCHIVE_EXTENSIONS, icon: FileArchive, className: "h-3.5 w-3.5 shrink-0 text-orange-300" },
  { extensions: MARKUP_EXTENSIONS, icon: FileType, className: "h-3.5 w-3.5 shrink-0 text-cyan-300" },
];

function iconForExtension(ext: string) {
  const group = ICON_GROUPS.find((item) => item.extensions.includes(ext));
  if (!group) return null;
  const Icon = group.icon;
  return <Icon className={group.className} />;
}

export function FileTypeIcon({ path }: { path: string }) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return iconForExtension(ext) ?? <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--da-muted)]" />;
}
