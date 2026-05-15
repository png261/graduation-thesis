"""Structured output model for the reviewer agent."""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from agents.specialist_output import SpecialistResponse


class ReviewerOutput(SpecialistResponse):
    agent: Literal["reviewer_agent"] = "reviewer_agent"
    reviewed_scope: list[str] = Field(default_factory=list, description="Files, modules, or behaviors reviewed.")
