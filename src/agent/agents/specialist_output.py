"""Shared structured response models for specialist agents."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


SpecialistStatus = Literal["complete", "blocked", "needs_input", "failed"]
Severity = Literal["critical", "high", "medium", "low", "info"]
VerificationStatus = Literal["passed", "failed", "not_run", "not_applicable"]


class SpecialistFinding(BaseModel):
    severity: Severity = Field(description="Impact level of the finding.")
    title: str = Field(description="Short finding title.")
    evidence: list[str] = Field(default_factory=list, description="Concrete evidence, paths, commands, or observations.")
    recommendation: str = Field(default="", description="Actionable mitigation or next step.")


class SpecialistArtifact(BaseModel):
    type: str = Field(description="Artifact kind, for example file, plan, diagram, report, or pull_request.")
    path: str = Field(default="", description="Workspace or artifact path when available.")
    url: str = Field(default="", description="Public or service URL when available.")
    description: str = Field(default="", description="Short human-readable description.")


class SpecialistVerification(BaseModel):
    command: str = Field(default="", description="Scoped wrapper tool or validation command that was run.")
    status: VerificationStatus = Field(default="not_run", description="Verification outcome.")
    summary: str = Field(default="", description="Result summary including important stdout/stderr if relevant.")


class SpecialistResponse(BaseModel):
    """Common envelope returned by every specialist agent tool."""

    agent: str = Field(description="Specialist agent name, such as engineer_agent.")
    status: SpecialistStatus = Field(description="Whether the delegated task is complete, blocked, needs input, or failed.")
    summary: str = Field(description="One concise paragraph the orchestrator can reuse in the final response.")
    assumptions: list[str] = Field(default_factory=list, description="Assumptions made because input was incomplete.")
    actions: list[str] = Field(default_factory=list, description="Important actions taken by the specialist.")
    changed_files: list[str] = Field(default_factory=list, description="Files created or modified by this specialist.")
    findings: list[SpecialistFinding] = Field(default_factory=list, description="Prioritized findings, risks, or review notes.")
    verifications: list[SpecialistVerification] = Field(default_factory=list, description="Commands or wrapper tools run and their outcomes.")
    artifacts: list[SpecialistArtifact] = Field(default_factory=list, description="Generated files, reports, diagrams, plans, or URLs.")
    next_steps: list[str] = Field(default_factory=list, description="Remaining useful follow-up work.")
    handoff_questions: list[str] = Field(default_factory=list, description="Questions requiring user input before progress can continue.")
    data: dict[str, Any] = Field(default_factory=dict, description="Agent-specific structured details.")


STRUCTURED_OUTPUT_CONTRACT = (
    "\n\n## Structured Output Contract\n"
    "Return your final answer as the structured output model requested by the runtime. "
    "Populate `status`, `summary`, `assumptions`, `actions`, `changed_files`, "
    "`findings`, `verifications`, `artifacts`, `next_steps`, and "
    "`handoff_questions` as applicable. Use `status=needs_input` only when user "
    "input is required, `status=blocked` for external blockers, `status=failed` "
    "when your task could not be completed, and `status=complete` when the "
    "delegated task is done. Keep `summary` concise so the orchestrator can reuse "
    "it directly."
    " When user input is needed, call `handoff_to_user` if that tool is available "
    "and then return `status=needs_input` with the same questions in "
    "`handoff_questions`."
)
