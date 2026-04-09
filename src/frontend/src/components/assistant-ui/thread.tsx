import { AttachmentPrimitive, MessagePrimitive, ThreadPrimitive, useAttachment } from "@assistant-ui/react";
import { FileImage, FileText } from "lucide-react";

import { AssistantMessage } from "./assistant-message";
import { ThreadRunningPlaceholder } from "./thread-running-placeholder";
import { ThreadComposer } from "./thread-composer";

function UserAttachment() {
  const isImage = useAttachment((attachment) => attachment.type === "image");
  return (
    <AttachmentPrimitive.Root className="inline-flex items-center gap-2 rounded-full border border-[var(--da-border)] bg-[var(--da-panel)] px-3 py-1 text-xs text-[var(--da-text)]">
      {isImage ? (
        <FileImage className="h-3.5 w-3.5 text-[var(--da-muted)]" aria-hidden />
      ) : (
        <FileText className="h-3.5 w-3.5 text-[var(--da-muted)]" aria-hidden />
      )}
      <span className="max-w-40 truncate"><AttachmentPrimitive.Name /></span>
    </AttachmentPrimitive.Root>
  );
}

function UserAttachments() {
  return (
    <MessagePrimitive.If hasAttachments>
      <div className="mb-2 flex flex-wrap gap-2">
        <MessagePrimitive.Attachments components={{ Attachment: UserAttachment }} />
      </div>
    </MessagePrimitive.If>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="aui-user-message-root">
      <UserAttachments />
      <MessagePrimitive.If hasContent>
        <div className="aui-user-message-content">
          <MessagePrimitive.Parts />
        </div>
      </MessagePrimitive.If>
    </MessagePrimitive.Root>
  );
}

interface ThreadProps {
  onOpenHistory: () => void;
}

function ThreadMessages() {
  return <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />;
}

export function Thread({ onOpenHistory }: ThreadProps) {
  return (
    <ThreadPrimitive.Root className="aui-thread-root">
      <ThreadPrimitive.Viewport className="aui-thread-viewport">
        <ThreadMessages />
        <ThreadRunningPlaceholder />
      </ThreadPrimitive.Viewport>
      <div className="aui-thread-composer">
        <ThreadComposer onOpenHistory={onOpenHistory} />
      </div>
    </ThreadPrimitive.Root>
  );
}
