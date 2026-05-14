"""Tools available to the security prover agent."""

from agents.runtime import AgentRuntimeTools, pick_tools
from agents.security_prover.config import TOOL_NAMES


def create_tools(runtime_tools: AgentRuntimeTools) -> list:
    return pick_tools(runtime_tools, TOOL_NAMES)

