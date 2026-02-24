import { tool, type UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";
import type { ChatMessage } from "@/lib/types";
import { generateUUID } from "@/lib/utils";
import { documentHandlersByEditorKind } from "@/lib/editor/server";

type CreateTofuPlanProps = {
    session: Session;
    dataStream: UIMessageStreamWriter<ChatMessage>;
    workspaceId?: string;
};

export const createTofuPlan = ({ session, dataStream, workspaceId }: CreateTofuPlanProps) =>
    tool({
        description: "Create an OpenTofu project for infrastructure management. This tool triggers the Tofu editor explorer.",
        inputSchema: z.object({
            title: z.string().describe("The title of the OpenTofu project."),
            description: z.string().optional().describe("Detailed description of the infrastructure requirements from the user's prompt."),
        }),
        execute: async ({ title, description }) => {
            const id = generateUUID();
            const kind = "terraform";

            dataStream.write({
                type: "data-kind",
                data: kind,
                transient: true,
            });

            dataStream.write({
                type: "data-id",
                data: id,
                transient: true,
            });

            dataStream.write({
                type: "data-title",
                data: title,
                transient: true,
            });

            dataStream.write({
                type: "data-clear",
                data: null,
                transient: true,
            });

            const documentHandler = documentHandlersByEditorKind.find(
                (handler) => handler.kind === kind
            );

            if (!documentHandler) {
                throw new Error(`No document handler found for kind: ${kind}`);
            }

            await documentHandler.onCreateDocument({
                id,
                title,
                description,
                dataStream,
                session,
                workspaceId,
            });

            dataStream.write({ type: "data-finish", data: null, transient: true });

            return {
                id,
                title,
                kind,
                content: "An OpenTofu project was created and is now visible to the user.",
            };
        },
    });
