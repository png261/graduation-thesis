"use client";
import type { UseChatHelpers } from "@ai-sdk/react";
import {
  FileEditIcon,
  LayersIcon,
  SparklesIcon as SparklesLucide,
  TerminalIcon,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import type { Vote } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/types";
import { cn, sanitizeText } from "@/lib/utils";
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtSearchResult,
  ChainOfThoughtSearchResults,
  ChainOfThoughtStep,
} from "./ai-elements/chain-of-thought";
import { Shimmer } from "./ai-elements/shimmer";
import { useDataStream } from "./data-stream-provider";
import { MessageContent } from "./elements/message";
import { Response } from "./elements/response";
import { SparklesIcon } from "./icons";
import { MessageActions } from "./message-actions";
import { MessageEditor } from "./message-editor";
import { MessageReasoning } from "./message-reasoning";
import { PreviewAttachment } from "./preview-attachment";

// ── Tool metadata ────────────────────────────────────────────────────────────

type ToolMeta = {
  label: string;
  icon: LucideIcon;
  activeVerb: string;
};

const TOOL_META: Record<string, ToolMeta> = {
  createTofuPlan: {
    label: "Create Terraform Plan",
    icon: LayersIcon,
    activeVerb: "Planning",
  },
  updateTofuProject: {
    label: "Update Terraform Project",
    icon: TerminalIcon,
    activeVerb: "Applying",
  },
  modifyWorkspaceFiles: {
    label: "Edit Workspace Files",
    icon: FileEditIcon,
    activeVerb: "Editing",
  },
};

function getToolName(type: string) {
  // AI SDK v6 uses "tool-{toolName}" part types
  return type.replace(/^tool-call-/, "").replace(/^tool-/, "");
}

function getToolMeta(type: string): ToolMeta {
  const name = getToolName(type);
  return (
    TOOL_META[name] ?? {
      label: name.replace(/([A-Z])/g, " $1").trim(),
      icon: SparklesLucide,
      activeVerb: "Running",
    }
  );
}

function getStepLabel(type: string, state: string | undefined, input: unknown): string {
  const meta = getToolMeta(type);
  if (state === "output-available") return meta.label;
  return meta.activeVerb + "…";
}

function getStepDescription(
  type: string,
  state: string | undefined,
  output: unknown
): string | null {
  if (state !== "output-available" || !output || typeof output !== "object")
    return null;
  const out = output as Record<string, unknown>;
  if (typeof out.message === "string") return out.message;
  if (Array.isArray(out.operations))
    return (out.operations as string[]).slice(0, 3).join(" · ") +
      (out.operations.length > 3
        ? ` +${out.operations.length - 3} more`
        : "");
  return null;
}

/** Badges shown beneath a step — file names, URLs, etc. */
function getStepBadges(type: string, input: unknown): string[] {
  const name = getToolName(type);
  if (!input || typeof input !== "object") return [];
  const inp = input as Record<string, unknown>;

  if (name === "modifyWorkspaceFiles") {
    const ops = inp.operations as Array<{ filename?: string; path?: string; folder?: string }> | undefined;
    return ops?.map((o) => o.filename ?? o.path ?? o.folder ?? "").filter(Boolean) ?? [];
  }
  if (name === "createTofuPlan" && typeof inp.title === "string") {
    return [inp.title];
  }
  return [];
}

const PurePreviewMessage = ({
  addToolApprovalResponse,
  chatId,
  message,
  vote,
  isLoading,
  setMessages,
  regenerate,
  isReadonly,
  requiresScrollPadding: _requiresScrollPadding,
}: {
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  chatId: string;
  message: ChatMessage;
  vote: Vote | undefined;
  isLoading: boolean;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  isReadonly: boolean;
  requiresScrollPadding: boolean;
}) => {
  const [mode, setMode] = useState<"view" | "edit">("view");

  const attachmentsFromMessage = message.parts.filter(
    (part) => part.type === "file"
  );

  useDataStream();

  return (
    <div
      className="group/message fade-in w-full animate-in duration-200"
      data-role={message.role}
      data-testid={`message-${message.role}`}
    >
      <div
        className={cn("flex w-full items-start gap-2 md:gap-3", {
          "justify-end": message.role === "user" && mode !== "edit",
          "justify-start": message.role === "assistant",
        })}
      >
        {message.role === "assistant" && (
          <div className="-mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border">
            <SparklesIcon size={14} />
          </div>
        )}

        <div
          className={cn("flex flex-col", {
            "gap-2 md:gap-4": message.parts?.some(
              (p) => p.type === "text" && p.text?.trim()
            ),
            "w-full":
              (message.role === "assistant" &&
                (message.parts?.some(
                  (p) => p.type === "text" && p.text?.trim()
                ) ||
                  message.parts?.some((p) => p.type.startsWith("tool-")))) ||
              mode === "edit",
            "max-w-[calc(100%-2.5rem)] sm:max-w-[min(fit-content,80%)]":
              message.role === "user" && mode !== "edit",
          })}
        >
          {attachmentsFromMessage.length > 0 && (
            <div
              className="flex flex-row justify-end gap-2"
              data-testid={"message-attachments"}
            >
              {attachmentsFromMessage.map((attachment) => (
                <PreviewAttachment
                  attachment={{
                    name: attachment.filename ?? "file",
                    contentType: attachment.mediaType,
                    url: attachment.url,
                  }}
                  key={attachment.url}
                />
              ))}
            </div>
          )}

          {(() => {
            const parts = message.parts ?? [];
            const rendered: React.ReactNode[] = [];
            let i = 0;

            while (i < parts.length) {
              const part = parts[i];
              const key = `message-${message.id}-part-${i}`;

              if (part.type === "reasoning") {
                const hasContent = part.text?.trim().length > 0;
                const isStreaming = "state" in part && part.state === "streaming";
                if (hasContent || isStreaming) {
                  rendered.push(
                    <MessageReasoning
                      isLoading={isLoading || isStreaming}
                      key={key}
                      reasoning={part.text || ""}
                    />
                  );
                }
                i++;
                continue;
              }

              if (part.type.startsWith("tool-")) {
                // Collect all consecutive tool-call parts
                const toolGroup: typeof parts = [];
                const groupStart = i;
                while (i < parts.length && parts[i].type.startsWith("tool-")) {
                  toolGroup.push(parts[i]);
                  i++;
                }
                const anyPending = toolGroup.some(
                  (p) => !("state" in p && p.state === "output-available")
                );
                rendered.push(
                  <ChainOfThought
                    defaultOpen={true}
                    key={`tools-${message.id}-${groupStart}`}
                  >
                    <ChainOfThoughtHeader>Agent Actions</ChainOfThoughtHeader>
                    <ChainOfThoughtContent>
                      {toolGroup.map((tp, ti) => {
                        if (!("state" in tp)) return null;
                        const meta = getToolMeta(tp.type);
                        const Icon = meta.icon;
                        const isDone = tp.state === "output-available";
                        const status = isDone ? "complete" : "active";
                        const label = getStepLabel(tp.type, tp.state, "input" in tp ? tp.input : undefined);
                        const description = isDone
                          ? getStepDescription(tp.type, tp.state, "output" in tp ? tp.output : undefined)
                          : null;
                        const badges = "input" in tp ? getStepBadges(tp.type, tp.input) : [];
                        const hasError = tp.state === "output-error";

                        return (
                          <ChainOfThoughtStep
                            description={
                              hasError && "errorText" in tp
                                ? String(tp.errorText)
                                : description ?? undefined
                            }
                            icon={Icon}
                            key={`step-${ti}`}
                            label={
                              isDone ? (
                                meta.label
                              ) : (
                                <span className="flex items-center gap-1.5">
                                  <Shimmer>{label}</Shimmer>
                                </span>
                              )
                            }
                            status={hasError ? "complete" : status}
                          >
                            {badges.length > 0 && (
                              <ChainOfThoughtSearchResults>
                                {badges.map((b) => (
                                  <ChainOfThoughtSearchResult key={b}>
                                    {b}
                                  </ChainOfThoughtSearchResult>
                                ))}
                              </ChainOfThoughtSearchResults>
                            )}
                          </ChainOfThoughtStep>
                        );
                      })}
                    </ChainOfThoughtContent>
                  </ChainOfThought>
                );
                continue;
              }

              if (part.type === "text") {
                if (mode === "view") {
                  rendered.push(
                    <div key={key}>
                      <MessageContent
                        className={cn({
                          "wrap-break-word w-fit rounded-2xl px-3 py-2 text-right text-white":
                            message.role === "user",
                          "bg-transparent px-0 py-0 text-left":
                            message.role === "assistant",
                        })}
                        data-testid="message-content"
                        style={
                          message.role === "user"
                            ? { backgroundColor: "#006cff" }
                            : undefined
                        }
                      >
                        <Response>{sanitizeText(part.text)}</Response>
                      </MessageContent>
                    </div>
                  );
                } else if (mode === "edit") {
                  rendered.push(
                    <div
                      className="flex w-full flex-row items-start gap-3"
                      key={key}
                    >
                      <div className="size-8" />
                      <div className="min-w-0 flex-1">
                        <MessageEditor
                          key={message.id}
                          message={message}
                          regenerate={regenerate}
                          setMessages={setMessages}
                          setMode={setMode}
                        />
                      </div>
                    </div>
                  );
                }
              }

              i++;
            }

            return rendered;
          })()}

          {!isReadonly && (
            <MessageActions
              chatId={chatId}
              isLoading={isLoading}
              key={`action-${message.id}`}
              message={message}
              setMode={setMode}
              vote={vote}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export const PreviewMessage = PurePreviewMessage;

export const ThinkingMessage = () => {
  return (
    <div
      className="group/message fade-in w-full animate-in duration-300"
      data-role="assistant"
      data-testid="message-assistant-loading"
    >
      <div className="flex items-start justify-start gap-3">
        <div className="-mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border">
          <div className="animate-pulse">
            <SparklesIcon size={14} />
          </div>
        </div>

        <div className="flex w-full flex-col gap-2 md:gap-4">
          <div className="flex items-center gap-1 p-0 text-muted-foreground text-sm">
            <Shimmer>Thinking</Shimmer>
          </div>
        </div>
      </div>
    </div>
  );
};
