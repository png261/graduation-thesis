import { MessagePrimitive } from "@assistant-ui/react";
import type { PropsWithChildren } from "react";

import {
  ASSISTANT_MESSAGE_BLUEPRINT_GROUP,
  ASSISTANT_MESSAGE_PLAN_GROUP,
  ASSISTANT_MESSAGE_REASONING_GROUP,
  ASSISTANT_MESSAGE_TOOL_GROUP,
  groupAssistantMessageParts,
} from "./assistant-message-groups";
import { BlueprintInputSummaryCard } from "./blueprint-input-summary-card";
import { BlueprintProvenanceCard } from "./blueprint-provenance-card";
import { BlueprintSuggestionCard } from "./blueprint-suggestion-card";
import { FilePreview } from "./file-preview";
import { ReasoningBlock, ReasoningGroup } from "./reasoning";
import { ToolCallCard } from "./tool-call-card";
import { ToolGroup } from "./tool-group";
import { UpdatePlanCard } from "./update-plan-card";

function AssistantPartGroup({
  children,
  groupKey,
  indices,
}: PropsWithChildren<{ groupKey: string | undefined; indices: number[] }>) {
  if (groupKey === ASSISTANT_MESSAGE_TOOL_GROUP) {
    return <ToolGroup count={indices.length}>{children}</ToolGroup>;
  }
  if (groupKey === ASSISTANT_MESSAGE_REASONING_GROUP) {
    const startIndex = indices[0] ?? 0;
    const endIndex = indices[indices.length - 1] ?? startIndex;
    return (
      <ReasoningGroup startIndex={startIndex} endIndex={endIndex}>
        {children}
      </ReasoningGroup>
    );
  }
  if (groupKey === ASSISTANT_MESSAGE_BLUEPRINT_GROUP) {
    return <div className="space-y-3">{children}</div>;
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
            Reasoning: ReasoningBlock,
            File: FilePreview,
            Group: AssistantPartGroup,
            tools: {
              by_name: {
                blueprint_inputs: BlueprintInputSummaryCard,
                blueprint_provenance: BlueprintProvenanceCard,
                generate_report: ToolCallCard,
                get_current_time: ToolCallCard,
                suggest_blueprints: BlueprintSuggestionCard,
                update_plan: UpdatePlanCard,
              },
              Fallback: ToolCallCard,
            },
          }}
        />
      </div>
    </MessagePrimitive.Root>
  );
}
