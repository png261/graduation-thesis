import { memo } from "react";
import { useEditor } from "@/hooks/use-editor";
import { CrossIcon } from "./icons";
import { Button } from "./ui/button";

function PureEditorCollapseButton() {
  const { editor, setEditor } = useEditor();

  return (
    <Button
      className="h-fit p-2 dark:hover:bg-zinc-700"
      data-testid="editor-collapse-button"
      onClick={() => {
        setEditor((currentEditor) => ({
          ...currentEditor,
          isVisible: !currentEditor.isVisible,
        }));
      }}
      variant="outline"
    >
      <CrossIcon size={18} />
    </Button>
  );
}

export const EditorCollapseButton = memo(PureEditorCollapseButton, () => true);
