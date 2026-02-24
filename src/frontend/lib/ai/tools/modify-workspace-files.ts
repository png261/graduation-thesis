import { tool, type UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";
import { getDocumentById } from "@/lib/db/queries";
import { saveDocument } from "@/lib/db/queries";
import type { ChatMessage } from "@/lib/types";

type ModifyWorkspaceFilesProps = {
    session: Session;
    dataStream: UIMessageStreamWriter<ChatMessage>;
    workspaceId?: string;
};

const operationSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("write"),
        // Accept both 'filename' and 'path' — LLMs sometimes use either
        filename: z.string().optional().describe("File path to create or overwrite (e.g. 'main.tf', 'modules/vpc/main.tf')."),
        path: z.string().optional().describe("Alias for filename — file path to create or overwrite."),
        content: z.string().describe("Complete new content for the file."),
        description: z.string().optional().describe("Brief description of what changed."),
    }),
    z.object({
        type: z.literal("delete_file"),
        filename: z.string().optional().describe("Path of the file to delete."),
        path: z.string().optional().describe("Alias for filename — path of the file to delete."),
    }),
    z.object({
        type: z.literal("delete_folder"),
        folder: z.string().optional().describe("Path of the folder to delete (removes entire directory and its contents)."),
        path: z.string().optional().describe("Alias for folder — path of the folder to delete."),
    }),
    z.object({
        type: z.literal("create_folder"),
        folder: z.string().optional().describe("Path of the new folder to create (e.g. 'modules/vpc')."),
        path: z.string().optional().describe("Alias for folder — path of the new folder to create."),
    }),
]);

export const modifyWorkspaceFiles = ({ session, dataStream, workspaceId }: ModifyWorkspaceFilesProps) =>
    tool({
        description: `Manage files and folders in the currently open workspace/project.
Use this when the user asks to:
- Edit, modify, update, or create a file  → type: "write"
- Delete / remove a file                  → type: "delete_file"
- Delete / remove a folder and contents   → type: "delete_folder"
- Create a new empty folder               → type: "create_folder"
Always use the document_id visible in the conversation context.
For "write" operations, always provide the FULL file content.`,
        inputSchema: z.object({
            documentId: z.string().describe("The ID of the open document/project to modify."),
            operations: z.array(operationSchema).describe("Ordered list of file system operations to perform."),
        }),
        execute: async ({ documentId, operations }) => {
            const document = await getDocumentById({ id: documentId });
            if (!document) {
                return { error: `Document with ID ${documentId} not found.` };
            }

            // Parse existing files
            let currentFiles: Record<string, string> = {};
            let fileTitles: string[] = [];
            try {
                const parsed = JSON.parse(document.content || "{}");
                if (parsed.files && Array.isArray(parsed.files)) {
                    parsed.files.forEach((f: { title: string; content: string }) => {
                        currentFiles[f.title] = f.content;
                        fileTitles.push(f.title);
                    });
                }
            } catch { /* raw content */ }

            // Signal editor to show document
            dataStream.write({ type: "data-kind", data: document.kind, transient: true });
            dataStream.write({ type: "data-id", data: document.id, transient: true });
            dataStream.write({ type: "data-title", data: document.title, transient: true });
            dataStream.write({ type: "data-clear", data: null, transient: true });

            const broadcast = () => {
                const json = JSON.stringify({
                    files: fileTitles.map((t) => ({ title: t, content: currentFiles[t] ?? "" })),
                });
                dataStream.write({ type: "data-terraformDelta", data: json, transient: true });
                return json;
            };

            broadcast();

            const results: string[] = [];
            const backendDeletePaths: string[] = [];

            for (const op of operations) {
                if (op.type === "write") {
                    const filename = (op.filename ?? op.path ?? "").trim();
                    const { content, description } = op;
                    if (!filename) { results.push("Skipped write: no filename provided"); continue; }
                    const isNew = !fileTitles.includes(filename);
                    if (isNew) {
                        fileTitles.push(filename);
                        currentFiles[filename] = "";
                        broadcast();
                    }
                    currentFiles[filename] = "";
                    let chunk = "";
                    for (let i = 0; i < content.length; i++) {
                        currentFiles[filename] += content[i];
                        chunk += content[i];
                        if (chunk.length > 80 || i === content.length - 1) {
                            broadcast();
                            chunk = "";
                            await new Promise((r) => setTimeout(r, 10));
                        }
                    }
                    results.push(`${isNew ? "Created" : "Updated"} ${filename}${description ? `: ${description}` : ""}`);

                } else if (op.type === "delete_file") {
                    const filename = (op.filename ?? op.path ?? "").trim();
                    if (!filename) { results.push("Skipped delete_file: no filename provided"); continue; }
                    const existed = fileTitles.includes(filename);
                    fileTitles = fileTitles.filter((t) => t !== filename);
                    delete currentFiles[filename];
                    if (existed) { broadcast(); backendDeletePaths.push(filename); }
                    results.push(`Deleted file: ${filename}${existed ? "" : " (not found)"}`);

                } else if (op.type === "delete_folder") {
                    const folder = (op.folder ?? op.path ?? "").trim();
                    if (!folder) { results.push("Skipped delete_folder: no folder provided"); continue; }
                    const prefix = folder.endsWith("/") ? folder : `${folder}/`;
                    const removed = fileTitles.filter((t) => t === folder || t.startsWith(prefix));
                    fileTitles = fileTitles.filter((t) => t !== folder && !t.startsWith(prefix));
                    for (const r of removed) delete currentFiles[r];
                    if (removed.length > 0) broadcast();
                    backendDeletePaths.push(folder);
                    results.push(`Deleted folder: ${folder} (${removed.length} file(s) removed)`);

                } else if (op.type === "create_folder") {
                    const folder = (op.folder ?? op.path ?? "").trim();
                    if (!folder) { results.push("Skipped create_folder: no folder provided"); continue; }
                    const gitkeep = `${folder}/.gitkeep`;
                    if (!fileTitles.includes(gitkeep)) {
                        fileTitles.push(gitkeep);
                        currentFiles[gitkeep] = "";
                        broadcast();
                    }
                    results.push(`Created folder: ${folder}`);
                }
            }

            // Persist to DB
            const newContent = JSON.stringify({
                files: fileTitles.map((t) => ({ title: t, content: currentFiles[t] ?? "" })),
            });
            if (session?.user?.id) {
                await saveDocument({
                    id: document.id,
                    title: document.title,
                    content: newContent,
                    kind: document.kind,
                    userId: session.user.id,
                    workspaceId,
                });
            }

            const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
            const targetId = workspaceId || documentId;

            // Write / create-folder ops → POST /files
            const writeOps = operations.filter((op) => op.type === "write");
            const folderOps = operations.filter((op) => op.type === "create_folder");
            if (writeOps.length > 0 || folderOps.length > 0) {
                try {
                    const filesPayload: Record<string, string> = {};
                    for (const op of writeOps) {
                        if (op.type === "write") {
                            const f = (op.filename ?? op.path ?? "").trim();
                            if (f) filesPayload[f] = op.content;
                        }
                    }
                    for (const op of folderOps) {
                        if (op.type === "create_folder") {
                            const f = (op.folder ?? op.path ?? "").trim();
                            if (f) filesPayload[`${f}/.gitkeep`] = "";
                        }
                    }
                    await fetch(`${BACKEND_URL}/project/${targetId}/files`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ chatId: targetId, files: filesPayload }),
                    });
                } catch (e) {
                    console.error("[modifyWorkspaceFiles] Failed to sync files to backend:", e);
                }
            }

            // Delete ops → DELETE /files
            if (backendDeletePaths.length > 0) {
                try {
                    await fetch(`${BACKEND_URL}/project/${targetId}/files`, {
                        method: "DELETE",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ paths: backendDeletePaths }),
                    });
                } catch (e) {
                    console.error("[modifyWorkspaceFiles] Failed to delete paths on backend:", e);
                }
            }

            dataStream.write({ type: "data-finish", data: null, transient: true });

            return {
                status: "success",
                operations: results,
                message: `Completed ${results.length} operation(s): ${results.join("; ")}`,
            };
        },
    });
