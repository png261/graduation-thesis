"""Orchestrator agent configuration."""

NAME = "orchestrator_agent"
DESCRIPTION = "Answers general questions, routes infrastructure work to specialists, and owns the final user-facing response."
TOOL_NAMES = (
    "handoff_to_user",
    "create_pull_request",
)
