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
import type { IconType } from "react-icons";
import {
  SiCss,
  SiGnubash,
  SiHtml5,
  SiJavascript,
  SiJson,
  SiMarkdown,
  SiPython,
  SiTerraform,
  SiTypescript,
  SiYaml,
} from "react-icons/si";

const CODE_EXTENSIONS = ["ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "rb", "php", "c", "cpp", "h"];
const DATA_EXTENSIONS = ["json", "yaml", "yml", "toml"];
const CONFIG_EXTENSIONS = ["tf", "hcl", "env", "ini", "conf", "config"];
const TEXT_EXTENSIONS = ["md", "txt", "rst"];
const SHELL_EXTENSIONS = ["sh", "bash", "zsh", "ps1"];
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"];
const VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "mkv"];
const ARCHIVE_EXTENSIONS = ["zip", "tar", "gz", "rar", "7z"];
const MARKUP_EXTENSIONS = ["html", "css", "scss", "less"];

type IconComponent = LucideIcon | IconType;

type IconGroup = { extensions: string[]; icon: IconComponent; className: string; token: FileIconToken };

export type FileIconToken =
  | "logo.typescript"
  | "logo.javascript"
  | "logo.python"
  | "logo.json"
  | "logo.yaml"
  | "logo.terraform"
  | "logo.markdown"
  | "logo.shell"
  | "logo.html"
  | "logo.css"
  | "generic.code"
  | "generic.data"
  | "generic.config"
  | "generic.text"
  | "generic.shell"
  | "generic.image"
  | "generic.video"
  | "generic.archive"
  | "generic.markup"
  | "default.file";

const LOGO_ICON_GROUPS: IconGroup[] = [
  { extensions: ["ts", "tsx"], icon: SiTypescript, className: "h-3.5 w-3.5 shrink-0 text-[#3178C6]", token: "logo.typescript" },
  { extensions: ["js", "jsx"], icon: SiJavascript, className: "h-3.5 w-3.5 shrink-0 text-[#F7DF1E]", token: "logo.javascript" },
  { extensions: ["py"], icon: SiPython, className: "h-3.5 w-3.5 shrink-0 text-[#3776AB]", token: "logo.python" },
  { extensions: ["json"], icon: SiJson, className: "h-3.5 w-3.5 shrink-0 text-[#F6C90E]", token: "logo.json" },
  { extensions: ["yaml", "yml"], icon: SiYaml, className: "h-3.5 w-3.5 shrink-0 text-[#CB171E]", token: "logo.yaml" },
  { extensions: ["tf", "hcl"], icon: SiTerraform, className: "h-3.5 w-3.5 shrink-0 text-[#7B42BC]", token: "logo.terraform" },
  { extensions: ["md"], icon: SiMarkdown, className: "h-3.5 w-3.5 shrink-0 text-[#E6EDF3]", token: "logo.markdown" },
  { extensions: ["sh", "bash", "zsh"], icon: SiGnubash, className: "h-3.5 w-3.5 shrink-0 text-[#4EAA25]", token: "logo.shell" },
  { extensions: ["html"], icon: SiHtml5, className: "h-3.5 w-3.5 shrink-0 text-[#E34F26]", token: "logo.html" },
  { extensions: ["css", "scss", "less"], icon: SiCss, className: "h-3.5 w-3.5 shrink-0 text-[#1572B6]", token: "logo.css" },
];

const GENERIC_ICON_GROUPS: IconGroup[] = [
  { extensions: CODE_EXTENSIONS, icon: FileCode, className: "h-3.5 w-3.5 shrink-0 text-sky-300", token: "generic.code" },
  { extensions: DATA_EXTENSIONS, icon: FileJson, className: "h-3.5 w-3.5 shrink-0 text-emerald-300", token: "generic.data" },
  { extensions: CONFIG_EXTENSIONS, icon: FileCog, className: "h-3.5 w-3.5 shrink-0 text-violet-300", token: "generic.config" },
  { extensions: TEXT_EXTENSIONS, icon: FileText, className: "h-3.5 w-3.5 shrink-0 text-amber-300", token: "generic.text" },
  { extensions: SHELL_EXTENSIONS, icon: Terminal, className: "h-3.5 w-3.5 shrink-0 text-lime-300", token: "generic.shell" },
  { extensions: IMAGE_EXTENSIONS, icon: FileImage, className: "h-3.5 w-3.5 shrink-0 text-pink-300", token: "generic.image" },
  { extensions: VIDEO_EXTENSIONS, icon: FileVideo, className: "h-3.5 w-3.5 shrink-0 text-fuchsia-300", token: "generic.video" },
  { extensions: ARCHIVE_EXTENSIONS, icon: FileArchive, className: "h-3.5 w-3.5 shrink-0 text-orange-300", token: "generic.archive" },
  { extensions: MARKUP_EXTENSIONS, icon: FileType, className: "h-3.5 w-3.5 shrink-0 text-cyan-300", token: "generic.markup" },
];

const ICON_GROUPS: IconGroup[] = [...LOGO_ICON_GROUPS, ...GENERIC_ICON_GROUPS];

function extensionFromPath(path: string) {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

function iconDefinitionForToken(token: FileIconToken): { icon: IconComponent; className: string } {
  const group = ICON_GROUPS.find((item) => item.token === token);
  if (group) return { icon: group.icon, className: group.className };
  return { icon: FileText, className: "h-3.5 w-3.5 shrink-0 text-[var(--da-muted)]" };
}

function tokenForExtension(ext: string): FileIconToken {
  if (!ext) return "default.file";
  const group = ICON_GROUPS.find((item) => item.extensions.includes(ext));
  if (!group) return "default.file";
  return group.token;
}

export function resolveFileIconToken(path: string): FileIconToken {
  const ext = extensionFromPath(path);
  return tokenForExtension(ext);
}

function iconForToken(token: FileIconToken) {
  const definition = iconDefinitionForToken(token);
  const Icon = definition.icon;
  return <Icon className={definition.className} />;
}

export function FileTypeIcon({ path }: { path: string }) {
  const token = resolveFileIconToken(path);
  return iconForToken(token);
}
