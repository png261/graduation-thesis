import type { ChatAgent } from "./types"

export const CHAT_AGENTS: ChatAgent[] = [
  {
    id: "agent1",
    mention: "@devops",
    name: "InfraQ",
    avatar: "IQ",
    className: "bg-slate-950 text-white",
  },
]

const LEGACY_AGENT_MENTIONS: Record<string, ChatAgent["id"]> = {
  "@agent1": "agent1",
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function findMentionedAgent(content: string): ChatAgent | undefined {
  const namedAgent = CHAT_AGENTS.find(agent =>
    new RegExp(`(^|\\s)${escapeRegex(agent.mention)}(?=\\s|$)`).test(content)
  )
  if (namedAgent) return namedAgent

  const legacyMention = Object.keys(LEGACY_AGENT_MENTIONS).find(mention =>
    new RegExp(`(^|\\s)${escapeRegex(mention)}(?=\\s|$)`).test(content)
  )
  return legacyMention
    ? CHAT_AGENTS.find(agent => agent.id === LEGACY_AGENT_MENTIONS[legacyMention])
    : undefined
}
