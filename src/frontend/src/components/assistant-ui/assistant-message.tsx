import { MessagePrimitive } from "@assistant-ui/react";

import { FilePreview } from "./file-preview";
import { ReasoningBlock, ReasoningGroup } from "./reasoning";
import { ToolCallCard } from "./tool-call-card";
import { ToolGroup } from "./tool-group";

export function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="aui-assistant-message-root">
      <div className="aui-assistant-message-content">
        <MessagePrimitive.Parts
          components={{
            Reasoning: ReasoningBlock,
            ReasoningGroup,
            File: FilePreview,
            ToolGroup,
            tools: {
              by_name: {
                generate_report: ToolCallCard,
                get_current_time: ToolCallCard,
              },
              Fallback: ToolCallCard,
            },
          }}
        />
      </div>
    </MessagePrimitive.Root>
  );
}
