type AssistantMessagePartLike = {
  type?: string;
  toolName?: string;
};

type AssistantMessageGroup = {
  groupKey: string | undefined;
  indices: number[];
};

export const ASSISTANT_MESSAGE_TOOL_GROUP = "tool-group";
export const ASSISTANT_MESSAGE_REASONING_GROUP = "reasoning-group";
export const ASSISTANT_MESSAGE_BLUEPRINT_GROUP = "blueprint-group";
export const ASSISTANT_MESSAGE_PLAN_GROUP = "plan-group";

function resolveGroupKey(part: AssistantMessagePartLike) {
  if (part.type === "reasoning") return ASSISTANT_MESSAGE_REASONING_GROUP;
  if (part.type !== "tool-call") return undefined;
  if (part.toolName === "write_todos") return undefined;
  if (part.toolName === "update_plan") return ASSISTANT_MESSAGE_PLAN_GROUP;
  return part.toolName === "suggest_blueprints" ? ASSISTANT_MESSAGE_BLUEPRINT_GROUP : ASSISTANT_MESSAGE_TOOL_GROUP;
}

function pushGroup(groups: AssistantMessageGroup[], groupKey: string | undefined, indices: number[]) {
  if (!groupKey || indices.length < 1) return;
  groups.push({ groupKey, indices: [...indices] });
}

export function groupAssistantMessageParts(parts: readonly AssistantMessagePartLike[]): AssistantMessageGroup[] {
  const groups: AssistantMessageGroup[] = [];
  let activeGroupKey: string | undefined;
  let activeIndices: number[] = [];

  for (const [index, part] of parts.entries()) {
    const nextGroupKey = resolveGroupKey(part);
    if (!nextGroupKey) {
      pushGroup(groups, activeGroupKey, activeIndices);
      activeGroupKey = undefined;
      activeIndices = [];
      groups.push({ groupKey: undefined, indices: [index] });
      continue;
    }
    if (nextGroupKey !== activeGroupKey) {
      pushGroup(groups, activeGroupKey, activeIndices);
      activeGroupKey = nextGroupKey;
      activeIndices = [index];
      continue;
    }
    activeIndices.push(index);
  }

  pushGroup(groups, activeGroupKey, activeIndices);
  return groups;
}
