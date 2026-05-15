"""TerraShark skill plugin configuration."""

from pathlib import Path

from strands import AgentSkills


TERRASHARK_SKILL_DIR = Path(__file__).resolve().parent / "terrashark"


def create_terrashark_plugin() -> AgentSkills:
    """Create a fresh TerraShark AgentSkills plugin instance for one agent."""
    return AgentSkills(skills=str(TERRASHARK_SKILL_DIR), max_resource_files=30)
