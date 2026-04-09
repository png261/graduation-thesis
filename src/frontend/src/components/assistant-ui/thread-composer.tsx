import { useEffect, useMemo, useRef, useState } from "react";

import {
  AttachmentPrimitive,
  AuiIf,
  ComposerPrimitive,
  ThreadListPrimitive,
  useAttachment,
  useThread,
  type ThreadAssistantMessagePart,
  type ThreadMessage,
  type ToolCallMessagePart,
} from "@assistant-ui/react";
import { ArrowUp, CircleX, FileImage, FileText, History, Paperclip, Plus, Square } from "lucide-react";

import {
  CHAT_ATTACHMENT_ERROR_EVENT,
  readAttachmentErrorMessage,
} from "../../runtime/local-runtime/documentAttachmentAdapter";
import { Plan } from "../tool-ui/plan";
import { safeParseWriteTodosPlan } from "../tool-ui/plan/schema";

interface ThreadComposerProps {
  onOpenHistory: () => void;
}

function isWriteTodosPart(part: ThreadAssistantMessagePart): part is ToolCallMessagePart {
  if (part.type !== "tool-call") return false;
  return parseWriteTodosPart(part) !== null;
}

function parseWriteTodosPart(part: ToolCallMessagePart) {
  return (
    safeParseWriteTodosPlan(part.result, `${part.toolCallId}-result`) ??
    safeParseWriteTodosPlan(part.args, `${part.toolCallId}-args`)
  );
}

function findLatestWriteTodosPlan(messages: readonly ThreadMessage[]) {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (message.role !== "assistant") continue;
    for (let partIndex = message.content.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.content[partIndex];
      if (!isWriteTodosPart(part)) continue;
      return parseWriteTodosPart(part);
    }
  }
  return null;
}

function ComposerSendButton() {
  return (
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
  );
}

function ComposerCancelButton() {
  return (
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
  );
}

function ComposerAttachmentItem() {
  const isImage = useAttachment((attachment) => attachment.type === "image");
  const typeLabel = useAttachment((attachment) => {
    if (attachment.type === "image") return "Image";
    if (attachment.type === "document") return "Document";
    return "File";
  });
  return (
    <AttachmentPrimitive.Root className="aui-attachment-root">
      <div className="aui-attachment-content">
        <div className="aui-attachment-thumb">
          {isImage ? <FileImage className="h-4 w-4" aria-hidden /> : <FileText className="h-4 w-4" aria-hidden />}
        </div>
        <div className="aui-attachment-text">
          <p className="aui-attachment-name">
            <AttachmentPrimitive.Name />
          </p>
          <p className="aui-attachment-type">{typeLabel}</p>
        </div>
      </div>
      <AttachmentPrimitive.Remove asChild>
        <button
          type="button"
          className="aui-attachment-remove"
          aria-label="Remove attachment"
          title="Remove attachment"
        >
          <CircleX className="h-4 w-4" aria-hidden />
        </button>
      </AttachmentPrimitive.Remove>
    </AttachmentPrimitive.Root>
  );
}

function ComposerAttachments() {
  const canAttach = useThread((thread) => thread.capabilities.attachments);
  if (!canAttach) return null;
  return (
    <div className="aui-composer-attachments">
      <ComposerPrimitive.Attachments components={{ Attachment: ComposerAttachmentItem }} />
    </div>
  );
}

function ComposerAddAttachmentButton() {
  const canAttach = useThread((thread) => thread.capabilities.attachments);
  if (!canAttach) return null;
  return (
    <ComposerPrimitive.AddAttachment asChild>
      <button
        type="button"
        className="assistant-thread-action aui-composer-attach"
        aria-label="Attach file"
        title="Attach file"
      >
        <Paperclip className="h-4 w-4" aria-hidden />
      </button>
    </ComposerPrimitive.AddAttachment>
  );
}

function ComposerInputArea() {
  return (
    <ComposerPrimitive.Root className="aui-composer-root">
      <ComposerAttachments />
      <ComposerPrimitive.Input className="aui-composer-input" placeholder="Ask about this project..." autoFocus />
      <ComposerAddAttachmentButton />
      <AuiIf condition={(state) => !state.thread.isRunning}>
        <ComposerSendButton />
      </AuiIf>
      <AuiIf condition={(state) => state.thread.isRunning}>
        <ComposerCancelButton />
      </AuiIf>
    </ComposerPrimitive.Root>
  );
}

function ComposerPlan() {
  const threadId = useThread((thread) => thread.threadId);
  const messages = useThread((thread) => thread.messages);
  const nextPlan = useMemo(() => findLatestWriteTodosPlan(messages), [messages]);
  const [plan, setPlan] = useState(() => nextPlan);
  const previousThreadId = useRef(threadId);

  useEffect(() => {
    if (previousThreadId.current !== threadId) {
      previousThreadId.current = threadId;
      setPlan(nextPlan);
      return;
    }
    if (!nextPlan) return;
    setPlan(nextPlan);
  }, [nextPlan, threadId]);

  if (!plan) return null;
  return <Plan {...plan} collapsible maxVisibleTodos={plan.maxVisibleTodos ?? 4} className="max-w-none min-w-0" />;
}

function ComposerActionButtons({ onOpenHistory }: { onOpenHistory: () => void }) {
  return (
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
  );
}

function ComposerMeta({ onOpenHistory }: { onOpenHistory: () => void }) {
  return (
    <div className="assistant-composer-meta">
      <ComposerActionButtons onOpenHistory={onOpenHistory} />
    </div>
  );
}

function ComposerAttachmentError() {
  const [message, setMessage] = useState("");

  useEffect(() => {
    const onError = (event: Event) => setMessage(readAttachmentErrorMessage(event));
    window.addEventListener(CHAT_ATTACHMENT_ERROR_EVENT, onError);
    return () => window.removeEventListener(CHAT_ATTACHMENT_ERROR_EVENT, onError);
  }, []);

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(""), 5000);
    return () => window.clearTimeout(timeout);
  }, [message]);

  if (!message) return null;
  return <p className="px-1 pt-2 text-xs text-red-400">{message}</p>;
}

export function ThreadComposer({ onOpenHistory }: ThreadComposerProps) {
  return (
    <div className="assistant-composer-shell">
      <ComposerPlan />
      <ComposerInputArea />
      <ComposerAttachmentError />
      <ComposerMeta onOpenHistory={onOpenHistory} />
    </div>
  );
}
