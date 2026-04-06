from __future__ import annotations

from typing import Any

from app.services.jobs.errors import JobValidationError
from app.services.jobs.types import JOB_KINDS


def _normalize_chat_attachment(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise JobValidationError("messages.attachments entries must be objects")
    name = payload.get("name")
    content = payload.get("content")
    content_type = payload.get("content_type", payload.get("contentType"))
    size_bytes = payload.get("size_bytes", payload.get("sizeBytes"))
    if not isinstance(name, str) or not name.strip():
        raise JobValidationError("messages.attachments.name must be a string")
    if not isinstance(content, str):
        raise JobValidationError("messages.attachments.content must be a string")
    if not isinstance(content_type, str):
        raise JobValidationError("messages.attachments.content_type must be a string")
    if size_bytes is not None and (not isinstance(size_bytes, int) or size_bytes < 0):
        raise JobValidationError("messages.attachments.size_bytes must be a non-negative integer")
    return {
        "name": name,
        "content": content,
        "content_type": content_type,
        **({"size_bytes": size_bytes} if size_bytes is not None else {}),
    }


def _parse_chat_payload(payload: dict[str, Any]) -> dict[str, Any]:
    messages = payload.get("messages", [])
    if not isinstance(messages, list) or len(messages) < 1:
        raise JobValidationError("messages must be a non-empty list")
    normalized_messages: list[dict[str, Any]] = []
    for row in messages:
        if not isinstance(row, dict):
            raise JobValidationError("messages entries must be objects")
        role = row.get("role")
        content = row.get("content")
        if role not in {"user", "assistant", "system"}:
            raise JobValidationError("messages.role must be one of: user, assistant, system")
        if not isinstance(content, str):
            raise JobValidationError("messages.content must be a string")
        normalized = {"role": role, "content": content}
        attachments = row.get("attachments")
        if attachments is not None:
            if not isinstance(attachments, list):
                raise JobValidationError("messages.attachments must be a list")
            normalized["attachments"] = [_normalize_chat_attachment(item) for item in attachments]
        normalized_messages.append(normalized)
    thread_id = payload.get("thread_id")
    if thread_id is not None and not isinstance(thread_id, str):
        raise JobValidationError("thread_id must be a string")
    project_id = payload.get("project_id")
    if not isinstance(project_id, str) or not project_id:
        raise JobValidationError("project_id is required")
    options = payload.get("options")
    if options is not None and not isinstance(options, dict):
        raise JobValidationError("options must be an object")
    return {
        "project_id": project_id,
        "thread_id": thread_id or None,
        "messages": normalized_messages,
        "options": options or {},
    }


def _parse_confirmation(payload: dict[str, Any]) -> dict[str, Any] | None:
    confirmation = payload.get("confirmation")
    if confirmation is None:
        return None
    if not isinstance(confirmation, dict):
        raise JobValidationError("confirmation must be an object")
    project_name = confirmation.get("project_name")
    keyword = confirmation.get("keyword")
    selected_modules = confirmation.get("selected_modules", [])
    if project_name is not None and not isinstance(project_name, str):
        raise JobValidationError("confirmation.project_name must be a string")
    if keyword is not None and not isinstance(keyword, str):
        raise JobValidationError("confirmation.keyword must be a string")
    if not isinstance(selected_modules, list) or any(not isinstance(row, str) for row in selected_modules):
        raise JobValidationError("confirmation.selected_modules must be a list of strings")
    return {
        "project_name": project_name or "",
        "keyword": keyword or "",
        "selected_modules": [row for row in selected_modules if isinstance(row, str)],
    }


def parse_job_payload(kind: str, payload: dict[str, Any]) -> dict[str, Any]:
    if kind not in JOB_KINDS:
        raise JobValidationError(f"Unsupported job kind '{kind}'")
    if kind == "chat":
        return _parse_chat_payload(payload)
    selected_modules = payload.get("selected_modules", [])
    if not isinstance(selected_modules, list):
        raise JobValidationError("selected_modules must be a list")
    if any(not isinstance(row, str) for row in selected_modules):
        raise JobValidationError("selected_modules entries must be strings")
    options = payload.get("options")
    if options is not None and not isinstance(options, dict):
        raise JobValidationError("options must be an object")
    intent = payload.get("intent")
    if intent is not None and not isinstance(intent, str):
        raise JobValidationError("intent must be a string")
    review_session_id = payload.get("review_session_id")
    if review_session_id is not None and not isinstance(review_session_id, str):
        raise JobValidationError("review_session_id must be a string")
    review_target = payload.get("review_target")
    if review_target is not None and not isinstance(review_target, str):
        raise JobValidationError("review_target must be a string")
    scope_mode = payload.get("scope_mode")
    if scope_mode is not None and not isinstance(scope_mode, str):
        raise JobValidationError("scope_mode must be a string")
    return {
        "selected_modules": [row for row in selected_modules if isinstance(row, str)],
        "intent": intent or None,
        "review_session_id": review_session_id or None,
        "review_target": review_target or None,
        "scope_mode": scope_mode or None,
        "confirmation": _parse_confirmation(payload),
        "options": options or {},
    }
