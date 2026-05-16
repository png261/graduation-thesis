"""Runtime tool registry shared by agent factories."""

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class AgentRuntimeTools:
    gateway: Any
    opentofu: Any
    handoff_to_user: Any
    file_read: Any
    file_write: Any
    terraform_init: Any
    terraform_plan: Any
    terraform_validate: Any
    ministack_terratest: Any
    tflint_scan: Any
    infracost_breakdown: Any
    checkov_scan: Any
    diagram: Any
    swarm: Any
    create_pull_request: Any | None = None


def pick_tools(runtime_tools: AgentRuntimeTools, names: tuple[str, ...]) -> list:
    tools = []
    for name in names:
        tool = getattr(runtime_tools, name)
        if tool is not None:
            tools.append(tool)
    return tools
