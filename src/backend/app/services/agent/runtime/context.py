from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.schemas.chat import ChatAttachment, ChatRequest, ChatRole


@dataclass(frozen=True)
class AttachmentContext:
    name: str
    kind: str
    content_type: str | None = None
    size_hint: int = 0


@dataclass(frozen=True)
class CostModuleContext:
    name: str
    monthly_cost: float = 0.0


@dataclass(frozen=True)
class InfraCostContext:
    currency: str = "USD"
    scope: str = "all"
    total_monthly_cost: float = 0.0
    generated_at: str = ""
    available_modules: tuple[str, ...] = ()
    modules: tuple[CostModuleContext, ...] = ()
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class DeepAgentContext:
    project_id: str = "default"
    thread_id: str = "default"
    latest_user_request: str = ""
    message_count: int = 0
    attachment_count: int = 0
    attachments: tuple[AttachmentContext, ...] = ()
    infra_cost: InfraCostContext | None = None


def _attachment_size_hint(attachment: ChatAttachment) -> int:
    if attachment.size_bytes is not None:
        return int(attachment.size_bytes)
    return len(attachment.content.encode("utf-8"))


def _attachment_context(attachment: ChatAttachment) -> AttachmentContext:
    return AttachmentContext(
        name=attachment.name,
        kind=attachment.type,
        content_type=attachment.content_type,
        size_hint=_attachment_size_hint(attachment),
    )


def _user_attachments(payload: ChatRequest) -> tuple[AttachmentContext, ...]:
    attachments: list[AttachmentContext] = []
    for message in payload.messages:
        if message.role is not ChatRole.user:
            continue
        attachments.extend(_attachment_context(item) for item in message.attachments)
    return tuple(attachments)


def _latest_user_request(payload: ChatRequest) -> str:
    for message in reversed(payload.messages):
        if message.role is ChatRole.user and message.content.strip():
            return message.content.strip()
    return ""


def _money(value: Any) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _cost_module(row: Any) -> CostModuleContext | None:
    if not isinstance(row, dict):
        return None
    name = str(row.get("name") or "").strip()
    if not name:
        return None
    return CostModuleContext(name=name, monthly_cost=_money(row.get("monthly_cost")))


def _cost_modules(payload: dict[str, Any]) -> tuple[CostModuleContext, ...]:
    modules = [_cost_module(row) for row in payload.get("modules") or []]
    return tuple(row for row in modules if row is not None)


def _available_modules(payload: dict[str, Any]) -> tuple[str, ...]:
    rows = []
    for item in payload.get("available_modules") or []:
        name = str(item or "").strip()
        if name:
            rows.append(name)
    return tuple(rows)


def build_infra_cost_context(payload: dict[str, Any]) -> InfraCostContext | None:
    if payload.get("status") != "ok":
        return None
    warnings = tuple(str(item) for item in payload.get("warnings") or [] if str(item).strip())
    return InfraCostContext(
        currency=str(payload.get("currency") or "USD").upper(),
        scope=str(payload.get("scope") or "all"),
        total_monthly_cost=_money(payload.get("total_monthly_cost")),
        generated_at=str(payload.get("generated_at") or ""),
        available_modules=_available_modules(payload),
        modules=_cost_modules(payload),
        warnings=warnings,
    )


def build_runtime_context(
    payload: ChatRequest,
    *,
    thread_id: str,
    infra_cost: InfraCostContext | None = None,
) -> DeepAgentContext:
    attachments = _user_attachments(payload)
    return DeepAgentContext(
        project_id=payload.project_id or "default",
        thread_id=thread_id,
        latest_user_request=_latest_user_request(payload),
        message_count=len(payload.messages),
        attachment_count=len(attachments),
        attachments=attachments,
        infra_cost=infra_cost,
    )
