"""Orchestrator agent configuration."""

NAME = "orchestrator_agent"
DESCRIPTION = "Coordinates specialist agents and owns the final user-facing response."
TOOL_NAMES = (
    "handoff_to_user",
    "create_pull_request",
)
