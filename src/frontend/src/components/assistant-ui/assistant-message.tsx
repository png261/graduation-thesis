import { MessagePrimitive } from "@assistant-ui/react";
import type { PropsWithChildren } from "react";

import {
  ASSISTANT_MESSAGE_PLAN_GROUP,
  ASSISTANT_MESSAGE_REASONING_GROUP,
  groupAssistantMessageParts,
} from "./assistant-message-groups";
import type { EvidenceBundlePayload } from "./evidence-bundle";
import { EvidenceBundleCard, EvidenceBundleToolCard } from "./evidence-bundle-card";
import { FilePreview } from "./file-preview";
import { ReasoningBlock, ReasoningGroup } from "./reasoning";
import { ToolCallCard } from "./tool-call-card";
import { UpdatePlanCard } from "./update-plan-card";
import { safeParseWriteTodosPlan } from "../tool-ui/plan/schema";

function HiddenWriteTodosFallback(props: Parameters<typeof ToolCallCard>[0]) {
  const plan =
    safeParseWriteTodosPlan(props.result, props.toolCallId ?? "write-todos-result") ??
    safeParseWriteTodosPlan(props.args, props.toolCallId ?? "write-todos-args");
  if (plan) return null;
  return <ToolCallCard {...props} />;
}

function AssistantPartGroup({
  children,
  groupKey,
  indices,
}: PropsWithChildren<{ groupKey: string | undefined; indices: number[] }>) {
  if (groupKey === ASSISTANT_MESSAGE_REASONING_GROUP) {
    const startIndex = indices[0] ?? 0;
    const endIndex = indices[indices.length - 1] ?? startIndex;
    return (
      <ReasoningGroup startIndex={startIndex} endIndex={endIndex}>
        {children}
      </ReasoningGroup>
    );
  }
  if (groupKey === ASSISTANT_MESSAGE_PLAN_GROUP) {
    return <div className="space-y-3">{children}</div>;
  }
  return <>{children}</>;
}

export function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="aui-assistant-message-root">
      <div className="aui-assistant-message-content">
        <MessagePrimitive.Unstable_PartsGrouped
          groupingFunction={groupAssistantMessageParts}
          components={{
            Text: EvidenceBundleCard,
            Reasoning: ReasoningBlock,
            File: FilePreview,
            Group: AssistantPartGroup,
            tools: {
              by_name: {
                evidence_bundle: ({ result }) => {
                  const bundle = result as EvidenceBundlePayload | null;
                  return bundle ? <EvidenceBundleToolCard bundle={bundle} /> : null;
                },
                generate_report: ToolCallCard,
                get_current_time: ToolCallCard,
                update_plan: UpdatePlanCard,
                write_todos: () => null,
              },
              Fallback: HiddenWriteTodosFallback,
            },
          }}
        />
      </div>
    </MessagePrimitive.Root>
  );
}
