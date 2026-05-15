"""Factory for the security prover agent."""

from strands import Agent

from agents.runtime import AgentRuntimeTools
from agents.security_prover.config import DESCRIPTION, NAME
from agents.security_prover.output import SecurityProverOutput
from agents.security_prover.system_prompt import SYSTEM_PROMPT
from agents.security_prover.tools import create_tools
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
        output_model=SecurityProverOutput,
    )
