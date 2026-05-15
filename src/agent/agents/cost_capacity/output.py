"""Structured output model for the cost and capacity agent."""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from agents.specialist_output import SpecialistResponse


class CostCapacityOutput(SpecialistResponse):
    agent: Literal["cost_capacity_agent"] = "cost_capacity_agent"
    cost_summary: str = Field(default="", description="Estimated cost and sizing summary.")
    cost_controls: list[str] = Field(default_factory=list, description="Recommended cost controls or guardrails.")
