import { tool, type UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";
import { getDocumentById } from "@/lib/db/queries";
import { documentHandlersByEditorKind } from "@/lib/editor/server";
import type { ChatMessage } from "@/lib/types";

type UpdateTofuProjectProps = {
    session: Session;
    dataStream: UIMessageStreamWriter<ChatMessage>;
    workspaceId?: string;
};

export const updateTofuProject = ({ session, dataStream, workspaceId }: UpdateTofuProjectProps) =>
    tool({
        description: "Update an existing OpenTofu project with new requirements. This tool triggers the editor to modify existing files.",
        inputSchema: z.object({
            id: z.string().describe("The ID of the document (workspace) to update."),
            description: z.string().describe("The user's requirements for the update."),
        }),
        execute: async ({ id, description }) => {
            const document = await getDocumentById({ id });

            if (!document) {
                return { error: `Document with ID ${id} not found.` };
            }

            const handler = documentHandlersByEditorKind.find(
                (h) => h.kind === document.kind
            );

            if (!handler) {
                return { error: `No handler found for document kind: ${document.kind}` };
            }

            dataStream.write({
                type: "data-kind",
                data: document.kind,
                transient: true,
            });

            dataStream.write({
                type: "data-id",
                data: document.id,
                transient: true,
            });

            dataStream.write({
                type: "data-title",
                data: document.title,
                transient: true,
            });

            await handler.onUpdateDocument({
                document,
                description,
                dataStream,
                session,
                workspaceId,
            });

            dataStream.write({ type: "data-finish", data: null, transient: true });

            return {
                id,
                status: "success",
                message: "Project update triggered and is now visible to the user.",
            };
        },
    });
