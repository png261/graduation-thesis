import { useThread } from "@assistant-ui/react";

type ThreadSnapshot = {
  isRunning: boolean;
  messages: readonly {
    role: "assistant" | "system" | "user";
  }[];
};

export function shouldShowRunningPlaceholder(thread: ThreadSnapshot) {
  if (!thread.isRunning) return false;
  const lastMessage = thread.messages[thread.messages.length - 1];
  return lastMessage?.role !== "assistant";
}

export function ThreadRunningPlaceholder() {
  const visible = useThread(shouldShowRunningPlaceholder);
  if (!visible) return null;

  return (
    <div className="aui-assistant-message-root aui-assistant-loading-root animate-in fade-in duration-200" role="status" aria-live="polite">
      <div className="aui-assistant-message-content">
        <div className="aui-assistant-loading-shell shimmer-container shimmer-angle-15 shimmer-speed-1200" aria-hidden="true">
          <div className="aui-assistant-loading-line aui-assistant-loading-line-short shimmer-bg" />
          <div className="aui-assistant-loading-line shimmer-bg" />
          <div className="aui-assistant-loading-line aui-assistant-loading-line-medium shimmer-bg" />
        </div>
        <span className="sr-only">Assistant is responding.</span>
      </div>
    </div>
  );
}
