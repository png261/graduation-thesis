"""Factory for the orchestrator agent."""

from strands import Agent

from agents.orchestator.config import DESCRIPTION, NAME
from agents.orchestator.system_prompt import repo_prompt
from agents.orchestator.tool import create_tools
from agents.runtime import AgentRuntimeTools


def create_agent(
    model,
    repository: dict | None,
    chat_agent: dict | None,
    runtime_tools: AgentRuntimeTools,
    session_manager,
    trace_attributes: dict,
) -> Agent:
    return Agent(
        model=model,
        name=NAME,
        description=DESCRIPTION,
        system_prompt=repo_prompt(repository, chat_agent),
        tools=create_tools(model, runtime_tools, trace_attributes),
        session_manager=session_manager,
        trace_attributes=trace_attributes,
    )
