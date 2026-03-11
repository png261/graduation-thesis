import type { FileEntry } from "../../../api/projects";
import type { TreeFolder, TreeNode } from "../types";

function isHiddenSegment(segment: string): boolean {
  return segment.startsWith(".") && segment !== "." && segment !== "..";
}

const ALLOWED_HIDDEN_FOLDERS = new Set([".github"]);

function isAllowedHiddenFolderSegment(segment: string): boolean {
  return ALLOWED_HIDDEN_FOLDERS.has(segment);
}

function ensureFolder(nodes: TreeNode[], name: string, path: string): TreeFolder {
  let folder = nodes.find((node): node is TreeFolder => node.type === "folder" && node.name === name);
  if (folder) return folder;
  folder = { type: "folder", name, path, children: [] };
  nodes.push(folder);
  return folder;
}

function shouldSkipTreeEntry(folders: string[], fileName: string) {
  if (folders.some((segment) => isHiddenSegment(segment) && !isAllowedHiddenFolderSegment(segment))) return true;
  return isHiddenSegment(fileName) && fileName !== ".gitkeep";
}

function addFileToTree(root: TreeNode[], file: FileEntry) {
  const normalized = file.path.replace(/^\//, "");
  if (!normalized) return;
  const parts = normalized.split("/");
  const folders = parts.slice(0, -1);
  const fileName = parts[parts.length - 1] ?? "";
  if (shouldSkipTreeEntry(folders, fileName)) return;
  let current = root;
  for (let index = 0; index < folders.length; index += 1) {
    const folderName = folders[index];
    const folderPath = `/${parts.slice(0, index + 1).join("/")}`;
    current = ensureFolder(current, folderName, folderPath).children;
  }
  if (fileName === ".gitkeep") return;
  current.push({ type: "file", name: fileName, path: file.path, size: file.size, modifiedAt: file.modifiedAt });
}

function sortTreeNodes(nodes: TreeNode[]) {
  nodes.sort((left, right) => {
    if (left.type !== right.type) return left.type === "folder" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  for (const node of nodes) {
    if (node.type === "folder") sortTreeNodes(node.children);
  }
}

export function buildTree(files: FileEntry[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const file of files) addFileToTree(root, file);
  sortTreeNodes(root);
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
