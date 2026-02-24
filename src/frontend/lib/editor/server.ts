import type { UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { terraformDocumentHandler } from "@/editors/terraform/server";
import { saveDocument } from "@/lib/db/queries";
import type { DocumentKind, Document } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/types";

// ... (existing imports)

export const documentHandlersByEditorKind: DocumentHandler[] = [
  terraformDocumentHandler,
];

export const editorKinds = ["terraform"] as const;
export type EditorKind = (typeof editorKinds)[number];

export type SaveDocumentProps = {
  id: string;
  title: string;
  kind: DocumentKind;
  content: string;
  userId: string;
  workspaceId?: string;
};

export type CreateDocumentCallbackProps = {
  id: string;
  title: string;
  description?: string;
  dataStream: UIMessageStreamWriter<ChatMessage>;
  session: Session;
  workspaceId?: string;
};

export type UpdateDocumentCallbackProps = {
  document: Document;
  description: string;
  dataStream: UIMessageStreamWriter<ChatMessage>;
  session: Session;
  workspaceId?: string;
};

export type DocumentHandler<T = DocumentKind> = {
  kind: T;
  onCreateDocument: (args: CreateDocumentCallbackProps) => Promise<void>;
  onUpdateDocument: (args: UpdateDocumentCallbackProps) => Promise<void>;
};

export function createDocumentHandler<T extends DocumentKind>(config: {
  kind: T;
  onCreateDocument: (params: CreateDocumentCallbackProps) => Promise<string>;
  onUpdateDocument: (params: UpdateDocumentCallbackProps) => Promise<string>;
}): DocumentHandler<T> {
  return {
    kind: config.kind,
    onCreateDocument: async (args: CreateDocumentCallbackProps) => {
      const draftContent = await config.onCreateDocument({
        id: args.id,
        title: args.title,
        description: args.description,
        dataStream: args.dataStream,
        session: args.session,
        workspaceId: args.workspaceId,
      });

      if (args.session?.user?.id) {
        await saveDocument({
          id: args.id,
          title: args.title,
          content: draftContent,
          kind: config.kind,
          userId: args.session.user.id,
          workspaceId: args.workspaceId,
        });
      }

      return;
    },
    onUpdateDocument: async (args: UpdateDocumentCallbackProps) => {
      const draftContent = await config.onUpdateDocument({
        document: args.document,
        description: args.description,
        dataStream: args.dataStream,
        session: args.session,
        workspaceId: args.workspaceId,
      });

      if (args.session?.user?.id) {
        await saveDocument({
          id: args.document.id,
          title: args.document.title,
          content: draftContent,
          kind: config.kind,
          userId: args.session.user.id,
          workspaceId: args.workspaceId,
        });
      }

      return;
    },
  };
}
