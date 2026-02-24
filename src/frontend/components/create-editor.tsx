import type { UseChatHelpers } from "@ai-sdk/react";
import type { DataUIPart } from "ai";
import type { ComponentType, Dispatch, ReactNode, SetStateAction } from "react";
import type { Suggestion } from "@/lib/db/schema";
import type { ChatMessage, CustomUIDataTypes } from "@/lib/types";
// Basic UIEditor type to avoid circular dependency
export type UIEditor = {
  title: string;
  documentId: string;
  kind: string;
  content: string;
  isVisible: boolean;
  status: "streaming" | "idle";
  boundingBox: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
};

export type EditorActionContext<M = any> = {
  content: string;
  handleVersionChange: (type: "next" | "prev" | "toggle" | "latest") => void;
  currentVersionIndex: number;
  isCurrentVersion: boolean;
  mode: "edit" | "diff";
  metadata: M;
  setMetadata: Dispatch<SetStateAction<M>>;
  chatId: string;
};

type EditorAction<M = any> = {
  icon: ReactNode;
  label?: string;
  description: string;
  onClick: (context: EditorActionContext<M>) => Promise<void> | void;
  isDisabled?: (context: EditorActionContext<M>) => boolean;
};

export type EditorToolbarContext = {
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
};

export type EditorToolbarItem = {
  description: string;
  icon: ReactNode;
  onClick: (context: EditorToolbarContext) => void;
};

type EditorContent<M = any> = {
  title: string;
  content: string;
  mode: "edit" | "diff";
  isCurrentVersion: boolean;
  currentVersionIndex: number;
  status: "streaming" | "idle";
  suggestions: Suggestion[];
  onSaveContent: (updatedContent: string, debounce: boolean) => void;
  isInline: boolean;
  getDocumentContentById: (index: number) => string;
  isLoading: boolean;
  metadata: M;
  setMetadata: Dispatch<SetStateAction<M>>;
  chatId?: string;
};

type InitializeParameters<M = any> = {
  documentId: string;
  setMetadata: Dispatch<SetStateAction<M>>;
};

type EditorConfig<T extends string, M = any> = {
  kind: T;
  description: string;
  content: ComponentType<EditorContent<M>>;
  actions: EditorAction<M>[];
  toolbar: EditorToolbarItem[];
  initialize?: (parameters: InitializeParameters<M>) => void;
  onStreamPart: (args: {
    setMetadata: Dispatch<SetStateAction<M>>;
    setEditor: Dispatch<SetStateAction<UIEditor>>;
    streamPart: DataUIPart<CustomUIDataTypes>;
  }) => void;
};

export class Editor<T extends string, M = any> {
  readonly kind: T;
  readonly description: string;
  readonly content: ComponentType<EditorContent<M>>;
  readonly actions: EditorAction<M>[];
  readonly toolbar: EditorToolbarItem[];
  readonly initialize?: (parameters: InitializeParameters) => void;
  readonly onStreamPart: (args: {
    setMetadata: Dispatch<SetStateAction<M>>;
    setEditor: Dispatch<SetStateAction<UIEditor>>;
    streamPart: DataUIPart<CustomUIDataTypes>;
  }) => void;

  constructor(config: EditorConfig<T, M>) {
    this.kind = config.kind;
    this.description = config.description;
    this.content = config.content;
    this.actions = config.actions || [];
    this.toolbar = config.toolbar || [];
    this.initialize = config.initialize || (async () => ({}));
    this.onStreamPart = config.onStreamPart;
  }
}
