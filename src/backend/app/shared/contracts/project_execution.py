from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping


def _string_value(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _string_tuple(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(item.strip() for item in value if isinstance(item, str) and item.strip())


@dataclass(frozen=True)
class ExecutionConfirmation:
    project_name: str = ""
    keyword: str = ""
    selected_modules: tuple[str, ...] = ()

    @classmethod
    def from_value(cls, value: Mapping[str, Any] | None) -> "ExecutionConfirmation | None":
        if value is None:
            return None
        return cls(
            project_name=_string_value(value.get("project_name")) or "",
            keyword=_string_value(value.get("keyword")) or "",
            selected_modules=_string_tuple(value.get("selected_modules")),
        )

    def to_payload(self) -> dict[str, Any]:
        return {
            "project_name": self.project_name,
            "keyword": self.keyword,
            "selected_modules": list(self.selected_modules),
        }


@dataclass(frozen=True)
class ProjectExecutionRequest:
    selected_modules: tuple[str, ...] = ()
    intent: str | None = None
    review_session_id: str | None = None
    review_target: str | None = None
    scope_mode: str | None = None
    confirmation: ExecutionConfirmation | None = None
    options: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any] | None) -> "ProjectExecutionRequest":
        payload = payload or {}
        options = payload.get("options")
        return cls(
            selected_modules=_string_tuple(payload.get("selected_modules")),
            intent=_string_value(payload.get("intent")),
            review_session_id=_string_value(payload.get("review_session_id")),
            review_target=_string_value(payload.get("review_target")),
            scope_mode=_string_value(payload.get("scope_mode")),
            confirmation=ExecutionConfirmation.from_value(payload.get("confirmation")),
            options=dict(options) if isinstance(options, dict) else {},
        )

    def effective_scope_mode(self) -> str:
        if self.scope_mode in {"full", "partial"}:
            return self.scope_mode
        return "partial" if self.selected_modules else "full"

    def resolved_review_target(self, default: str = "apply") -> str:
        return self.review_target or default

    def option_enabled(self, key: str) -> bool:
        return bool(self.options.get(key))

    def selected_modules_list(self) -> list[str]:
        return list(self.selected_modules)

    def to_job_payload(self) -> dict[str, Any]:
        return {
            "selected_modules": self.selected_modules_list(),
            "intent": self.intent,
            "review_session_id": self.review_session_id,
            "review_target": self.review_target,
            "scope_mode": self.scope_mode,
            "confirmation": self.confirmation.to_payload() if self.confirmation is not None else None,
            "options": dict(self.options),
        }
