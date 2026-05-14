"""Tool assembly for the orchestrator agent."""

from agents.architect.agent import create_tool as create_architect_tool
from agents.cost_capacity.agent import create_tool as create_cost_capacity_tool
from agents.devops.agent import create_tool as create_devops_tool
from agents.engineer.agent import create_tool as create_engineer_tool
from agents.orchestator.config import TOOL_NAMES
from agents.reviewer.agent import create_tool as create_reviewer_tool
from agents.runtime import AgentRuntimeTools, pick_tools
from agents.security_prover.agent import create_tool as create_security_prover_tool


SPECIALIST_TOOL_FACTORIES = (
    create_architect_tool,
    create_engineer_tool,
    create_reviewer_tool,
    create_cost_capacity_tool,
    create_security_prover_tool,
    create_devops_tool,
)


def create_tools(model, runtime_tools: AgentRuntimeTools, trace_attributes: dict) -> list:
    own_tools = pick_tools(runtime_tools, TOOL_NAMES)
    specialist_tools = [
        factory(
            model=model,
            runtime_tools=runtime_tools,
            trace_attributes={
                **trace_attributes,
                "specialist.agent": factory.__module__.split(".")[-2],
            },
        )
        for factory in SPECIALIST_TOOL_FACTORIES
    ]
    return [*own_tools, *specialist_tools]

