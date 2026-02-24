import { type Dispatch, memo, type SetStateAction, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { editorDefinitions } from "./editor";
import type { UIEditor, EditorActionContext } from "./create-editor";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

type EditorActionsProps = {
  editor: UIEditor;
  handleVersionChange: (type: "next" | "prev" | "toggle" | "latest") => void;
  currentVersionIndex: number;
  isCurrentVersion: boolean;
  mode: "edit" | "diff";
  metadata: any;
  setMetadata: Dispatch<SetStateAction<any>>;
  chatId: string;
};

function PureEditorActions({
  editor,
  handleVersionChange,
  currentVersionIndex,
  isCurrentVersion,
  mode,
  metadata,
  setMetadata,
  chatId,
}: EditorActionsProps) {
  const [isLoading, setIsLoading] = useState(false);

  const editorDefinition = editorDefinitions.find(
    (definition) => definition.kind === editor.kind
  );

  if (!editorDefinition) {
    return null;
  }

  const actionContext: EditorActionContext = {
    content: editor.content,
    handleVersionChange,
    currentVersionIndex,
    isCurrentVersion,
    mode,
    metadata,
    setMetadata,
    chatId,
  };

  return (
    <div className="flex flex-row gap-1">
      {editorDefinition.actions.map((action) => (
        <Tooltip key={action.description}>
          <TooltipTrigger asChild>
            <Button
              className={cn("h-fit dark:hover:bg-zinc-700", {
                "p-2": !action.label,
                "px-2 py-1.5": action.label,
              })}
              disabled={
                isLoading || editor.status === "streaming"
                  ? true
                  : action.isDisabled
                    ? action.isDisabled(actionContext)
                    : false
              }
              onClick={async () => {
                setIsLoading(true);

                try {
                  await Promise.resolve(action.onClick(actionContext));
                } catch (_error) {
                  toast.error("Failed to execute action");
                } finally {
                  setIsLoading(false);
                }
              }}
              variant="outline"
            >
              {action.icon}
              {action.label}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{action.description}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

export const EditorActions = memo(
  PureEditorActions,
  (prevProps, nextProps) => {
    if (prevProps.editor.status !== nextProps.editor.status) {
      return false;
    }
    if (prevProps.currentVersionIndex !== nextProps.currentVersionIndex) {
      return false;
    }
    if (prevProps.isCurrentVersion !== nextProps.isCurrentVersion) {
      return false;
    }
    if (prevProps.editor.content !== nextProps.editor.content) {
      return false;
    }

    return true;
  }
);
