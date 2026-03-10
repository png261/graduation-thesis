import type { FileEntry } from "../../../api/projects";
import type { TreeFolder, TreeNode } from "../types";

function isHiddenSegment(segment: string): boolean {
  return segment.startsWith(".") && segment !== "." && segment !== "..";
}

const ALLOWED_HIDDEN_FOLDERS = new Set([".github"]);

function isAllowedHiddenFolderSegment(segment: string): boolean {
  return ALLOWED_HIDDEN_FOLDERS.has(segment);
}

export function buildTree(files: FileEntry[]): TreeNode[] {
  const root: TreeNode[] = [];

  const ensureFolder = (nodes: TreeNode[], name: string, path: string): TreeFolder => {
    let folder = nodes.find(
      (node): node is TreeFolder => node.type === "folder" && node.name === name,
    );
    if (!folder) {
      folder = { type: "folder", name, path, children: [] };
      nodes.push(folder);
    }
    return folder;
  };

  for (const file of files) {
    const normalized = file.path.replace(/^\//, "");
    if (!normalized) continue;

    const parts = normalized.split("/");
    const folders = parts.slice(0, -1);
    const fileName = parts[parts.length - 1] ?? "";

    if (
      folders.some(
        (segment) => isHiddenSegment(segment) && !isAllowedHiddenFolderSegment(segment),
      )
    ) {
      continue;
    }
    if (isHiddenSegment(fileName) && fileName !== ".gitkeep") continue;

    let current = root;

    for (let i = 0; i < folders.length; i++) {
      const folderName = folders[i];
      const folderPath = "/" + parts.slice(0, i + 1).join("/");
      const folder = ensureFolder(current, folderName, folderPath);
      current = folder.children;
    }

    if (fileName === ".gitkeep") continue;

    current.push({
      type: "file",
      name: fileName,
      path: file.path,
      size: file.size,
      modifiedAt: file.modifiedAt,
    });
  }

  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.type === "folder") sortNodes(node.children);
    }
  };
  sortNodes(root);

  return root;
}

export function detectLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    tf: "hcl",
    hcl: "hcl",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
    sh: "shell",
    bash: "shell",
    css: "css",
    html: "html",
    xml: "xml",
    toml: "toml",
    rs: "rust",
    go: "go",
    java: "java",
    rb: "ruby",
    sql: "sql",
    txt: "plaintext",
  };
  return map[ext] ?? "plaintext";
}

export function toRepoName(projectId: string): string {
  return `project-${projectId.slice(0, 8)}`;
}
