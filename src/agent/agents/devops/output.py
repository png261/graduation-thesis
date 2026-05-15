"""Structured output model for the DevOps agent."""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from agents.specialist_output import SpecialistResponse


class DevOpsOutput(SpecialistResponse):
    agent: Literal["devops_agent"] = "devops_agent"
    release_readiness: str = Field(default="", description="Deployment, CI/CD, and operational readiness summary.")
    operational_risks: list[str] = Field(default_factory=list, description="Operational risks to address before release.")
