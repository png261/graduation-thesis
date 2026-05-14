"""Tools available to the engineer agent."""

from agents.engineer.config import TOOL_NAMES
from agents.runtime import AgentRuntimeTools, pick_tools


def create_tools(runtime_tools: AgentRuntimeTools) -> list:
    return pick_tools(runtime_tools, TOOL_NAMES)

