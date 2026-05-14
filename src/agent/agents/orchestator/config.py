"""Orchestrator agent configuration."""

NAME = "orchestrator_agent"
DESCRIPTION = "Coordinates specialist agents and owns the final user-facing response."
TOOL_NAMES = (
    "gateway",
    "opentofu",
    "handoff_to_user",
    "render_architecture_diagram",
    "read_excalidraw_guide",
    "create_excalidraw_view",
    "file_read",
    "file_write",
    "shell",
    "diagram",
    "swarm",
    "create_pull_request",
)

