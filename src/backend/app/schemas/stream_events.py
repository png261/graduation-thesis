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


class DoneEvent(BaseStreamEvent):
    type: Literal["done"]


StreamEvent = UsageEvent | PolicyCheckStartEvent | PolicyCheckResultEvent | DoneEvent | dict[str, Any]
