"""Structured output model for the security prover agent."""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from agents.specialist_output import SpecialistResponse


class SecurityProverOutput(SpecialistResponse):
    agent: Literal["security_prover_agent"] = "security_prover_agent"
    security_posture: str = Field(default="", description="Overall security posture summary.")
    required_controls: list[str] = Field(default_factory=list, description="Security controls required before release.")
