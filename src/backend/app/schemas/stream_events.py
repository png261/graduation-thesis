from __future__ import annotations

from typing import Any, Literal, TypedDict


class BaseStreamEvent(TypedDict, total=False):
    type: str


class PolicyCheckStartEvent(BaseStreamEvent):
    type: Literal["policy.check.start"]
    changedPaths: list[str]


class PolicyCheckResultEvent(BaseStreamEvent):
    type: Literal["policy.check.result"]
    issues: list[dict[str, Any]]
    summary: dict[str, Any]
    scanError: dict[str, str] | None
    changedPaths: list[str]


class EvidenceBundleEvent(BaseStreamEvent):
    type: Literal["evidence.bundle"]
    schemaVersion: int
    changedFiles: list[str]
    validationsRun: list[str]
    passFailEvidence: list[str]
    unresolvedRisks: list[str]
    completionRationale: list[str]


class DoneEvent(BaseStreamEvent):
    type: Literal["done"]


class IncidentClassifiedEvent(BaseStreamEvent):
    type: Literal["incident.classified"]
    correlationId: str
    incidentKey: str
    severity: str
    confidence: float
    evidence: list[dict[str, Any]]


class IncidentMemoryHitEvent(BaseStreamEvent):
    type: Literal["incident.memory.hit"]
    correlationId: str
    incidentKey: str
    count: int
    incidentIds: list[str]


class IncidentActionBlockedEvent(BaseStreamEvent):
    type: Literal["incident.action.blocked"]
    correlationId: str
    incidentKey: str
    recommendedAction: str | None
    reason: str | None


class IncidentRecommendationEvent(BaseStreamEvent):
    type: Literal["incident.recommendation"]
    correlationId: str
    incidentKey: str
    severity: str
    confidence: float
    recommendedAction: str
    approvalRequired: bool
    actionClass: str
    analysisOnly: bool


StreamEvent = (
    PolicyCheckStartEvent
    | PolicyCheckResultEvent
    | EvidenceBundleEvent
    | IncidentClassifiedEvent
    | IncidentMemoryHitEvent
    | IncidentActionBlockedEvent
    | IncidentRecommendationEvent
    | DoneEvent
    | dict[str, Any]
)
