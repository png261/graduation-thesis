from __future__ import annotations

from typing import Any

from app.services.jobs.errors import JobValidationError
from app.services.jobs.types import JOB_KINDS


def _parse_chat_payload(payload: dict[str, Any]) -> dict[str, Any]:
    messages = payload.get("messages", [])
    if not isinstance(messages, list) or len(messages) < 1:
        raise JobValidationError("messages must be a non-empty list")
    normalized_messages: list[dict[str, str]] = []
    for row in messages:
        if not isinstance(row, dict):
            raise JobValidationError("messages entries must be objects")
        role = row.get("role")
        content = row.get("content")
        if role not in {"user", "assistant", "system"}:
            raise JobValidationError("messages.role must be one of: user, assistant, system")
        if not isinstance(content, str):
            raise JobValidationError("messages.content must be a string")
        normalized_messages.append({"role": role, "content": content})
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
    return {
        "selected_modules": [row for row in selected_modules if isinstance(row, str)],
        "intent": intent or None,
        "options": options or {},
    }
