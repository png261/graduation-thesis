import { MessagePrimitive, ThreadPrimitive } from "@assistant-ui/react";

import type { Suggestion } from "../../lib/suggestions";
import { AssistantMessage } from "./assistant-message";
import { ThreadRunningPlaceholder } from "./thread-running-placeholder";
import { ThreadComposer } from "./thread-composer";

function UserMessage() {
  return (
    <MessagePrimitive.Root className="aui-user-message-root">
      <div className="aui-user-message-content">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

interface ThreadProps {
  suggestions: Suggestion[];
  onOpenHistory: () => void;
}

function ThreadSuggestions({ suggestions }: { suggestions: Suggestion[] }) {
  return (
    <div className="aui-thread-welcome-root">
      <div className="aui-thread-welcome-suggestions">
        {suggestions.map((suggestion) => (
          <ThreadPrimitive.Suggestion key={suggestion.text} prompt={suggestion.prompt} send className="aui-thread-welcome-suggestion">
            {suggestion.text}
          </ThreadPrimitive.Suggestion>
        ))}
      </div>
    </div>
  );
}

function ThreadMessages() {
  return <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />;
}

export function Thread({ suggestions, onOpenHistory }: ThreadProps) {
  return (
    <ThreadPrimitive.Root className="aui-thread-root">
      <ThreadPrimitive.Viewport className="aui-thread-viewport">
        <ThreadPrimitive.Empty>
          <ThreadSuggestions suggestions={suggestions} />
        </ThreadPrimitive.Empty>
        <ThreadMessages />
        <ThreadRunningPlaceholder />
      </ThreadPrimitive.Viewport>
      <div className="aui-thread-composer">
        <ThreadComposer onOpenHistory={onOpenHistory} />
      </div>
    </ThreadPrimitive.Root>
  );
}
