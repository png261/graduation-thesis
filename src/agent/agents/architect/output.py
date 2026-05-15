"""Structured output model for the architect agent."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field

from agents.specialist_output import SpecialistArtifact, SpecialistResponse


class ArchitectOutput(SpecialistResponse):
    agent: Literal["architect_agent"] = "architect_agent"
    architecture: dict[str, Any] = Field(default_factory=dict, description="Architecture resources, relationships, and constraints.")
    diagram: SpecialistArtifact | None = Field(default=None, description="Generated architecture diagram artifact when one was created.")
