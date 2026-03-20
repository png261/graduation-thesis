from __future__ import annotations

from typing import Any, Literal, TypedDict


class BaseStreamEvent(TypedDict, total=False):
    type: str


class UsageEvent(BaseStreamEvent):
    type: Literal["usage"]
    promptTokens: int
    completionTokens: int
    modelId: str | None
    modelContextWindow: int | None


class PolicyCheckStartEvent(BaseStreamEvent):
    type: Literal["policy.check.start"]
    changedPaths: list[str]


class PolicyCheckResultEvent(BaseStreamEvent):
    type: Literal["policy.check.result"]
    issues: list[dict[str, Any]]
    summary: dict[str, Any]
    scanError: dict[str, str] | None
    changedPaths: list[str]


class BlueprintInputSummaryItem(TypedDict, total=False):
    key: str
    label: str
    required: bool
    riskClass: str
    defaultValue: str | None
    resolved: bool
    value: str | None


class BlueprintStepPayload(TypedDict):
    id: str
    type: str
    title: str
    description: str
    requiredInputs: list[str]
    expectedResult: str


class BlueprintPayload(TypedDict):
    id: str
    kind: str
    name: str
    summary: str
    resourcesOrActions: list[str]
    requiredInputs: list[BlueprintInputSummaryItem]
    steps: list[BlueprintStepPayload]


class BlueprintSuggestionsEvent(BaseStreamEvent):
    type: Literal["blueprint.suggestions"]
    kind: str
    suggestions: list[BlueprintPayload]


class BlueprintInputsSummaryEvent(BaseStreamEvent):
    type: Literal["blueprint.inputs.summary"]
    kind: str
    blueprintId: str
    blueprintName: str
    inputs: list[BlueprintInputSummaryItem]


class BlueprintProvenanceEvent(BaseStreamEvent):
    type: Literal["blueprint.provenance"]
    kind: str
    source: str
    runId: str | None
    createdAt: str | None
    inputs: dict[str, str]
    blueprint: BlueprintPayload


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
    UsageEvent
    | PolicyCheckStartEvent
    | PolicyCheckResultEvent
    | BlueprintSuggestionsEvent
    | BlueprintInputsSummaryEvent
    | BlueprintProvenanceEvent
    | IncidentClassifiedEvent
    | IncidentMemoryHitEvent
    | IncidentActionBlockedEvent
    | IncidentRecommendationEvent
    | DoneEvent
    | dict[str, Any]
)
