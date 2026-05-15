"""Structured output model for the engineer agent."""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from agents.specialist_output import SpecialistResponse


class EngineerOutput(SpecialistResponse):
    agent: Literal["engineer_agent"] = "engineer_agent"
    implementation_notes: list[str] = Field(default_factory=list, description="Notable implementation choices and tradeoffs.")
