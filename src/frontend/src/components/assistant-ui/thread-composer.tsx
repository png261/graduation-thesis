import { AuiIf, ComposerPrimitive, ThreadListPrimitive } from "@assistant-ui/react";
import { ArrowUp, History, Plus, Square } from "lucide-react";

import { ContextDisplay } from "./context-display";

interface ThreadComposerProps {
  onOpenHistory: () => void;
}

export function ThreadComposer({ onOpenHistory }: ThreadComposerProps) {
  return (
    <div className="assistant-composer-shell">
      <ComposerPrimitive.Root className="aui-composer-root">
        <ComposerPrimitive.Input
          className="aui-composer-input"
          placeholder="Ask about this project..."
          autoFocus
        />
        <AuiIf condition={(s) => !s.thread.isRunning}>
          <ComposerPrimitive.Send asChild>
            <button
              type="submit"
              className="assistant-thread-action aui-composer-send"
              aria-label="Send message"
              title="Send"
            >
              <ArrowUp className="h-4 w-4" aria-hidden />
            </button>
          </ComposerPrimitive.Send>
        </AuiIf>
        <AuiIf condition={(s) => s.thread.isRunning}>
          <ComposerPrimitive.Cancel asChild>
            <button
              type="button"
              className="assistant-thread-action aui-composer-cancel"
              aria-label="Cancel response"
              title="Cancel response"
            >
              <Square className="h-4 w-4" aria-hidden />
            </button>
          </ComposerPrimitive.Cancel>
        </AuiIf>
      </ComposerPrimitive.Root>
      <div className="assistant-composer-meta">
        <div className="assistant-composer-actions">
          <ThreadListPrimitive.New asChild>
            <button
              type="button"
              className="assistant-thread-action"
              aria-label="Start new thread"
              title="Start new thread"
            >
              <Plus className="h-4 w-4" aria-hidden />
            </button>
          </ThreadListPrimitive.New>

          <button
            type="button"
            className="assistant-thread-action"
            onClick={onOpenHistory}
            aria-label="Open thread history"
            title="Thread history"
          >
            <History className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <ContextDisplay className="assistant-composer-context" />
      </div>
    </div>
  );
}
