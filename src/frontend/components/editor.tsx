import type { UseChatHelpers } from "@ai-sdk/react";
import { formatDistance } from "date-fns";
import equal from "fast-deep-equal";
import { AnimatePresence, motion } from "framer-motion";
import {
  type Dispatch,
  memo,
  type SetStateAction,
  useCallback,
  useEffect,
  useState,
  useRef,
} from "react";
import useSWR, { useSWRConfig } from "swr";
import { useDebounceCallback, useWindowSize } from "usehooks-ts";
import { terraformEditor } from "@/editors/terraform/client";
import { useEditor } from "@/hooks/use-editor";
import { usePendingChanges } from "@/hooks/use-pending-changes";
import { PendingChangesBar } from "./pending-changes-bar";
import type { Document, Vote } from "@/lib/db/schema";
import type { Attachment, ChatMessage } from "@/lib/types";
import { fetcher } from "@/lib/utils";
import { EditorActions } from "./editor-actions";
import { EditorCollapseButton } from "./editor-collapse-button";
import { EditorMessages } from "./editor-messages";
import { MultimodalInput } from "./multimodal-input";
import { Toolbar } from "./toolbar";

import { VersionFooter } from "./version-footer";
import type { VisibilityType } from "./visibility-selector";

export const editorDefinitions = [
  terraformEditor,
];
export type EditorKind = (typeof editorDefinitions)[number]["kind"];

import { type UIEditor } from "./create-editor";

function PureEditor({
  addToolApprovalResponse,
  chatId,
  workspaceId,
  input,
  setInput,
  status,
  stop,
  attachments,
  setAttachments,
  sendMessage,
  messages,
  setMessages,
  regenerate,
  votes,
  isReadonly,
  selectedVisibilityType,
  selectedModelId,
}: {
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  chatId: string;
  workspaceId?: string;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  status: UseChatHelpers<ChatMessage>["status"];
  stop: UseChatHelpers<ChatMessage>["stop"];
  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  messages: ChatMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  votes: Vote[] | undefined;
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  isReadonly: boolean;
  selectedVisibilityType: VisibilityType;
  selectedModelId: string;
}) {
  const { editor, setEditor, metadata, setMetadata } = useEditor();

  const {
    data: documents,
    isLoading: isDocumentsFetching,
    mutate: mutateDocuments,
  } = useSWR<Document[]>(
    editor.documentId !== "init" && editor.status !== "streaming"
      ? `/api/document?id=${editor.documentId}`
      : null,
    fetcher
  );

  const [mode, setMode] = useState<"edit" | "diff">("edit");
  const [document, setDocument] = useState<Document | null>(null);
  const [currentVersionIndex, setCurrentVersionIndex] = useState(-1);



  // ---- Git Pending Changes ----
  const {
    changes,
    acceptFile,
    acceptAll,
    rejectAll,
    refresh: refreshPending,
    acceptingFiles,
  } = usePendingChanges(workspaceId ?? chatId);

  const prevStatus = useRef(editor.status);

  useEffect(() => {
    if (prevStatus.current === "streaming" && editor.status === "idle" && editor.content) {
      let filesMap: Record<string, string> = {};
      try {
        const parsed = JSON.parse(editor.content);
        if (parsed.files && Array.isArray(parsed.files)) {
          parsed.files.forEach((f: any) => {
            filesMap[f.title] = f.content;
          });
        } else {
          filesMap["main.tf"] = editor.content;
        }
      } catch (e) {
        filesMap["main.tf"] = editor.content;
      }

      if (Object.keys(filesMap).length > 0) {
        import("@/lib/git-api").then(({ gitCreatePending }) => {
          gitCreatePending(workspaceId ?? chatId, filesMap, "Agent updated files").then(() => {
            refreshPending();
          });
        });
      }
    }
    prevStatus.current = editor.status;
  }, [editor.status, editor.content, chatId, workspaceId, refreshPending]);

  const [activeFile, setActiveFile] = useState<string | undefined>();
  // ------------------------------

  useEffect(() => {
    if (documents && documents.length > 0) {
      const mostRecentDocument = documents.at(-1);

      if (mostRecentDocument) {
        setDocument(mostRecentDocument);
        setCurrentVersionIndex(documents.length - 1);
        setEditor((currentEditor: UIEditor) => ({
          ...currentEditor,
          content: mostRecentDocument.content ?? "",
        }));
      }
    }
  }, [documents, setEditor]);

  useEffect(() => {
    mutateDocuments();
  }, [mutateDocuments]);

  const { mutate } = useSWRConfig();
  const [isContentDirty, setIsContentDirty] = useState(false);

  const handleContentChange = useCallback(
    (updatedContent: string) => {
      if (!editor) {
        return;
      }

      mutate<Document[]>(
        `/api/document?id=${editor.documentId}`,
        async (currentDocuments) => {
          if (!currentDocuments) {
            return [];
          }

          const currentDocument = currentDocuments.at(-1);

          if (!currentDocument || !currentDocument.content) {
            setIsContentDirty(false);
            return currentDocuments;
          }

          if (currentDocument.content !== updatedContent) {
            await fetch(`/api/document?id=${editor.documentId}`, {
              method: "POST",
              body: JSON.stringify({
                title: editor.title,
                content: updatedContent,
                kind: editor.kind,
              }),
            });

            setIsContentDirty(false);

            const newDocument = {
              ...currentDocument,
              content: updatedContent,
              createdAt: new Date(),
            };

            return [...currentDocuments, newDocument];
          }
          return currentDocuments;
        },
        { revalidate: false }
      );
    },
    [editor, mutate]
  );

  const debouncedHandleContentChange = useDebounceCallback(
    handleContentChange,
    2000
  );

  const saveContent = useCallback(
    (updatedContent: string, debounce: boolean) => {
      if (document && updatedContent !== document.content) {
        setIsContentDirty(true);

        if (debounce) {
          debouncedHandleContentChange(updatedContent);
        } else {
          handleContentChange(updatedContent);
        }
      }
    },
    [document, debouncedHandleContentChange, handleContentChange]
  );

  function getDocumentContentById(index: number) {
    if (!documents) {
      return "";
    }
    if (!documents[index]) {
      return "";
    }
    return documents[index].content ?? "";
  }

  const handleVersionChange = (type: "next" | "prev" | "toggle" | "latest") => {
    if (!documents) {
      return;
    }

    if (type === "latest") {
      setCurrentVersionIndex(documents.length - 1);
      setMode("edit");
    }

    if (type === "toggle") {
      setMode((currentMode) => (currentMode === "edit" ? "diff" : "edit"));
    }

    if (type === "prev") {
      if (currentVersionIndex > 0) {
        setCurrentVersionIndex((index) => index - 1);
      }
    } else if (type === "next" && currentVersionIndex < documents.length - 1) {
      setCurrentVersionIndex((index) => index + 1);
    }
  };

  const [isToolbarVisible, setIsToolbarVisible] = useState(false);

  /*
   * NOTE: if there are no documents, or if
   * the documents are being fetched, then
   * we mark it as the current version.
   */

  const isCurrentVersion =
    documents && documents.length > 0
      ? currentVersionIndex === documents.length - 1
      : true;

  const { width: windowWidth, height: windowHeight } = useWindowSize();
  const isMobile = windowWidth ? windowWidth < 768 : false;

  const editorDefinition = editorDefinitions.find(
    (definition) => definition.kind === editor.kind
  );

  useEffect(() => {
    if (editor.documentId !== "init" && editorDefinition?.initialize) {
      editorDefinition.initialize({
        documentId: editor.documentId,
        setMetadata,
      });
    }
  }, [editor.documentId, editorDefinition, setMetadata]);

  if (!editorDefinition) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        animate={{ opacity: 1 }}
        className="relative flex h-full flex-1 min-w-0 flex-col border-l border-zinc-200 bg-background dark:border-zinc-700 dark:bg-muted"
        data-testid="editor"
        exit={{ opacity: 0 }}
        initial={{ opacity: 0 }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
      >
        <div className="flex flex-1 h-full w-full overflow-hidden bg-background dark:bg-muted">
          <div className="flex flex-col flex-1 min-w-0">
            <editorDefinition.content
              chatId={chatId}
              content={
                isCurrentVersion
                  ? editor.content
                  : getDocumentContentById(currentVersionIndex)
              }
              currentVersionIndex={currentVersionIndex}
              getDocumentContentById={getDocumentContentById}
              isCurrentVersion={isCurrentVersion}
              isInline={false}
              isLoading={isDocumentsFetching && !editor.content}
              metadata={metadata}
              mode={mode}
              onSaveContent={saveContent}
              setMetadata={setMetadata}
              status={editor.status}
              suggestions={[]}
              title={editor.title}
            />

            <AnimatePresence>
              {isCurrentVersion && (
                <Toolbar
                  editorKind={editor.kind as EditorKind}
                  isToolbarVisible={isToolbarVisible}
                  sendMessage={sendMessage}
                  setIsToolbarVisible={setIsToolbarVisible}
                  setMessages={setMessages}
                  status={status}
                  stop={stop}
                />
              )}
            </AnimatePresence>

            <PendingChangesBar
              changes={changes}
              onAcceptFile={acceptFile}
              onAcceptAll={acceptAll}
              onRejectAll={rejectAll}
              onSelectFile={setActiveFile}
              activeFile={activeFile}
              acceptingFiles={acceptingFiles}
            />
          </div>

        </div>

        <AnimatePresence>
          {!isCurrentVersion && (
            <VersionFooter
              currentVersionIndex={currentVersionIndex}
              documents={documents}
              handleVersionChange={handleVersionChange}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence >
  );
}

export const Editor = memo(PureEditor, (prevProps, nextProps) => {
  if (prevProps.status !== nextProps.status) {
    return false;
  }
  if (!equal(prevProps.votes, nextProps.votes)) {
    return false;
  }
  if (prevProps.input !== nextProps.input) {
    return false;
  }
  if (!equal(prevProps.messages, nextProps.messages.length)) {
    return false;
  }
  if (prevProps.selectedVisibilityType !== nextProps.selectedVisibilityType) {
    return false;
  }

  return true;
});
