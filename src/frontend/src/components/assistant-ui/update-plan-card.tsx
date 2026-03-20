import type { ToolCallMessagePartProps } from "@assistant-ui/react";

import { Plan } from "../tool-ui/plan";
import { safeParseAgentPlan, safeParseSerializablePlan } from "../tool-ui/plan/schema";
import { ToolCallCard } from "./tool-call-card";

function parsePlan(props: ToolCallMessagePartProps) {
  return (
    safeParseSerializablePlan(props.result) ??
    safeParseSerializablePlan(props.args) ??
    safeParseAgentPlan(props.args, props.toolCallId ?? "plan") ??
    safeParseAgentPlan(props.result, props.toolCallId ?? "plan")
  );
}

export function UpdatePlanCard(props: ToolCallMessagePartProps) {
  const plan = parsePlan(props);
  if (!plan) return <ToolCallCard {...props} />;
  return <Plan {...plan} />;
}
