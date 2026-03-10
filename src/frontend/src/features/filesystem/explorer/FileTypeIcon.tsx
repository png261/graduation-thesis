import {
  FileArchive,
  FileCode,
  FileCog,
  FileImage,
  FileJson,
  FileText,
  FileType,
  FileVideo,
  Terminal,
} from "lucide-react";

export function FileTypeIcon({ path }: { path: string }) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";

  if (["ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "rb", "php", "c", "cpp", "h"].includes(ext)) {
    return <FileCode className="h-3.5 w-3.5 shrink-0 text-sky-300" />;
  }

  if (["json", "yaml", "yml", "toml"].includes(ext)) {
    return <FileJson className="h-3.5 w-3.5 shrink-0 text-emerald-300" />;
  }

  if (["tf", "hcl", "env", "ini", "conf", "config"].includes(ext)) {
    return <FileCog className="h-3.5 w-3.5 shrink-0 text-violet-300" />;
  }

  if (["md", "txt", "rst"].includes(ext)) {
    return <FileText className="h-3.5 w-3.5 shrink-0 text-amber-300" />;
  }

  if (["sh", "bash", "zsh", "ps1"].includes(ext)) {
    return <Terminal className="h-3.5 w-3.5 shrink-0 text-lime-300" />;
  }

  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"].includes(ext)) {
    return <FileImage className="h-3.5 w-3.5 shrink-0 text-pink-300" />;
  }

  if (["mp4", "webm", "mov", "mkv"].includes(ext)) {
    return <FileVideo className="h-3.5 w-3.5 shrink-0 text-fuchsia-300" />;
  }

  if (["zip", "tar", "gz", "rar", "7z"].includes(ext)) {
    return <FileArchive className="h-3.5 w-3.5 shrink-0 text-orange-300" />;
  }

  if (["html", "css", "scss", "less"].includes(ext)) {
    return <FileType className="h-3.5 w-3.5 shrink-0 text-cyan-300" />;
  }

  return <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--da-muted)]" />;
}
