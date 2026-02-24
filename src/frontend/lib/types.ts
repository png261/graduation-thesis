import type { InferUITool, UIMessage } from "ai";
import { z } from "zod";
import type { EditorKind } from "@/components/editor";
import type { Suggestion } from "./db/schema";
import type { createTofuPlan } from "./ai/tools/create-tofu-plan";
import type { updateTofuProject } from "./ai/tools/update-tofu-project";
import type { modifyWorkspaceFiles } from "./ai/tools/modify-workspace-files";

export type DataPart = { type: "append-message"; message: string };

export const messageMetadataSchema = z.object({
  createdAt: z.string(),
});

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

type createTofuPlanTool = InferUITool<ReturnType<typeof createTofuPlan>>;
type updateTofuProjectTool = InferUITool<ReturnType<typeof updateTofuProject>>;
type modifyWorkspaceFilesTool = InferUITool<ReturnType<typeof modifyWorkspaceFiles>>;

export type ChatTools = {
  createTofuPlan: createTofuPlanTool;
  updateTofuProject: updateTofuProjectTool;
  modifyWorkspaceFiles: modifyWorkspaceFilesTool;
};

export type CustomUIDataTypes = {
  textDelta: string;
  terraformDelta: string;
  suggestion: Suggestion;
  appendMessage: string;
  id: string;
  title: string;
  kind: EditorKind;
  clear: null;
  finish: null;
  "chat-title": string;
};

export type ChatMessage = UIMessage<
  MessageMetadata,
  CustomUIDataTypes,
  ChatTools
>;

export type Attachment = {
  name: string;
  url: string;
  contentType: string;
};
