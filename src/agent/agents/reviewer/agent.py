"""Factory for the reviewer agent."""

from strands import Agent

from agents.reviewer.config import DESCRIPTION, NAME
from agents.reviewer.output import ReviewerOutput
from agents.reviewer.system_prompt import SYSTEM_PROMPT
from agents.reviewer.tools import create_tools
from agents.runtime import AgentRuntimeTools
from agents.tool_adapter import create_agent_text_tool


def create_agent(model, runtime_tools: AgentRuntimeTools, trace_attributes: dict) -> Agent:
    return Agent(
        model=model,
        name=NAME,
        description=DESCRIPTION,
        system_prompt=SYSTEM_PROMPT,
        tools=create_tools(runtime_tools),
        callback_handler=None,
        trace_attributes=trace_attributes,
    )


def create_tool(model, runtime_tools: AgentRuntimeTools, trace_attributes: dict):
    return create_agent_text_tool(
        name=NAME,
        description=DESCRIPTION,
        create_agent=create_agent,
        model=model,
        runtime_tools=runtime_tools,
        trace_attributes=trace_attributes,
        output_model=ReviewerOutput,
    )
