"""Structured output model for the orchestrator agent."""

from __future__ import annotations

from typing import Literal

from agents.specialist_output import SpecialistResponse


class OrchestratorOutput(SpecialistResponse):
    agent: Literal["orchestrator_agent"] = "orchestrator_agent"
