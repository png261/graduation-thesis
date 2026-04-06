from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Any, AsyncIterator, Awaitable, Callable

from fastapi import HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from langchain_core.messages import AIMessage, BaseMessage, ToolMessage

from app import db
from app.core.config import Settings
from app.models import Project
from app.schemas.chat import ChatAttachment, ChatMessage, ChatRequest, ChatRole
from app.services.agent import get_agent
from app.services.blueprints import service as blueprint_service
from app.services.model.factory import create_chat_model
from app.services.policy import checks as policy_checks

from .streaming_helpers import (
    extract_messages_from_obj,
    extract_text_events,
    normalize_tool_calls,
    parse_tool_result,
)
from .usage import (
    context_window_fallback,
    extract_usage_from_message,
    max_input_tokens_from_profile,
    normalize_model_id,
    text_from_content,
    to_int,
)

CancelChecker = Callable[[], Awaitable[bool]]

_REQUEST_HINTS = ("can you", "could you", "please", "help me", "i need", "i want", "let's", "lets")
_BLUEPRINT_SUGGESTION_ACTIONS = ("show", "suggest", "recommend", "list")
_BLUEPRINT_REFERENCE_TERMS = ("blueprint", "template")
_CONFIGURATION_HOST_ACTIONS = ("install", "configure")
_CONFIGURATION_HOST_TARGETS = ("host", "server", "vm", "instance", "machine", "node")
_CONFIGURATION_SOFTWARE_ACTIONS = ("install", "configure", "set up", "setup")
_CONFIGURATION_SOFTWARE_TARGETS = ("openclaw", "package", "agent", "daemon")
_CONFIGURATION_GENERATE_ACTIONS = ("create", "build", "generate")
_CONFIGURATION_GENERATE_TARGETS = ("ansible", "playbook", "role", "inventory")
_PROVISIONING_ACTIONS = (
    "provision",
    "create",
    "build",
    "generate",
    "deploy",
    "spin up",
    "scaffold",
    "bootstrap",
    "set up",
    "setup",
)
_PROVISIONING_TARGETS = (
    "terraform",
    "opentofu",
    "infrastructure",
    "infra",
    "iac",
    "aws",
    "gcp",
    "azure",
    "ec2",
    "vpc",
    "subnet",
    "rds",
    "eks",
    "cluster",
    "kubernetes",
    "load balancer",
    "lb",
    "vm",
    "instance",
    "server",
    "database",
    "network",
)
_DOCUMENT_ATTACHMENT_EXTENSIONS = frozenset(
    {
        ".txt",
        ".md",
        ".json",
        ".yaml",
        ".yml",
        ".csv",
        ".xml",
        ".log",
        ".ini",
    }
)
_ATTACHMENT_MAX_COUNT = 3
_DOCUMENT_MAX_BYTES = 128 * 1024
_DOCUMENT_MAX_CHARS_PER_FILE = 8000
_DOCUMENT_MAX_CHARS_TOTAL = 16000
_IMAGE_MAX_BYTES = 5 * 1024 * 1024
_IMAGE_CONTENT_TYPES = frozenset({"image/png", "image/jpeg", "image/webp", "image/gif"})
_EXPLICIT_BINARY_CONTENT_TYPES = frozenset(
    {
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    }
)
_IMAGE_TOKEN_BUDGET = 1024


def _bad_chat_request(message: str) -> None:
    raise HTTPException(status_code=400, detail=message)


def _attachment_extension(name: str) -> str:
    return Path(name).suffix.lower()


def _attachment_size_bytes(attachment: ChatAttachment) -> int:
    actual_size = len(attachment.content.encode("utf-8"))
    if attachment.size_bytes is None:
        return actual_size
    if attachment.type == "image":
        return int(attachment.size_bytes)
    return max(actual_size, int(attachment.size_bytes))


def _is_explicitly_binary(content_type: str | None) -> bool:
    if not content_type:
        return False
    lowered = content_type.lower()
    if lowered.startswith(("image/", "audio/", "video/")):
        return True
    return lowered in _EXPLICIT_BINARY_CONTENT_TYPES


def _validate_document_attachment(attachment: ChatAttachment) -> int:
    if _attachment_extension(attachment.name) not in _DOCUMENT_ATTACHMENT_EXTENSIONS:
        _bad_chat_request(f"Unsupported attachment '{attachment.name}'")
    if _is_explicitly_binary(attachment.content_type):
        _bad_chat_request(f"Unsupported attachment type for '{attachment.name}'")
    if _attachment_size_bytes(attachment) > _DOCUMENT_MAX_BYTES:
        _bad_chat_request(f"Attachment '{attachment.name}' exceeds {_DOCUMENT_MAX_BYTES} bytes")
    content_chars = len(attachment.content)
    if content_chars > _DOCUMENT_MAX_CHARS_PER_FILE:
        _bad_chat_request(f"Attachment '{attachment.name}' exceeds {_DOCUMENT_MAX_CHARS_PER_FILE} characters")
    return content_chars


def _validate_image_attachment(attachment: ChatAttachment) -> None:
    if attachment.content_type not in _IMAGE_CONTENT_TYPES:
        _bad_chat_request(f"Unsupported image attachment '{attachment.name}'")
    if _attachment_size_bytes(attachment) > _IMAGE_MAX_BYTES:
        _bad_chat_request(f"Image '{attachment.name}' exceeds {_IMAGE_MAX_BYTES} bytes")
    if not attachment.content.startswith("data:image/"):
        _bad_chat_request(f"Invalid image attachment '{attachment.name}'")


def _validate_message_attachments(messages: list[ChatMessage]) -> None:
    for message in messages:
        if message.role is not ChatRole.user and message.attachments:
            _bad_chat_request("attachments are only supported on user messages")
        if not message.attachments:
            continue
        if len(message.attachments) > _ATTACHMENT_MAX_COUNT:
            _bad_chat_request(f"A message can include at most {_ATTACHMENT_MAX_COUNT} attachments")
        total_document_chars = 0
        for attachment in message.attachments:
            if attachment.type == "image":
                _validate_image_attachment(attachment)
                continue
            total_document_chars += _validate_document_attachment(attachment)
        if total_document_chars > _DOCUMENT_MAX_CHARS_TOTAL:
            _bad_chat_request(f"Attachment content exceeds {_DOCUMENT_MAX_CHARS_TOTAL} characters per message")


def _attachment_block(attachment: ChatAttachment) -> str:
    content_type = attachment.content_type or "text/plain"
    return "\n".join(
        (
            f"[Attached document: {attachment.name}]",
            f"[Content-Type: {content_type}]",
            attachment.content,
            f"[End attached document: {attachment.name}]",
        )
    )


def _message_content(message: ChatMessage) -> str | list[dict[str, Any]]:
    if not message.attachments:
        return message.content
    parts: list[dict[str, Any]] = []
    if message.content.strip():
        parts.append({"type": "text", "text": message.content})
    for attachment in message.attachments:
        if attachment.type == "image":
            parts.append({"type": "image_url", "image_url": {"url": attachment.content}})
            continue
        parts.append({"type": "text", "text": _attachment_block(attachment)})
    return parts


def ensure_settings(settings: Settings) -> None:
    if not settings.llm_api_key:
        raise HTTPException(status_code=500, detail="LLM_API_KEY is not set")
    if not settings.llm_model:
        raise HTTPException(status_code=500, detail="LLM_MODEL is not set")


def ensure_payload(payload: ChatRequest) -> None:
    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages are required")
    _validate_message_attachments(payload.messages)


def _to_langchain_messages(request: ChatRequest) -> list[dict]:
    return [{"role": message.role.value, "content": _message_content(message)} for message in request.messages]


def _approx_token_count(text: str) -> int:
    return max(1, len(text) // 4)


def _messages_token_count(messages: list[dict[str, Any]]) -> int:
    total = 0
    for row in messages:
        content = row.get("content")
        if isinstance(content, list):
            for item in content:
                if not isinstance(item, dict):
                    total += _approx_token_count(str(item))
                    continue
                if item.get("type") == "text":
                    total += _approx_token_count(str(item.get("text") or ""))
                    continue
                if item.get("type") == "image_url":
                    total += _IMAGE_TOKEN_BUDGET
                    continue
                total += _approx_token_count(str(item))
            continue
        total += _approx_token_count(str(content or ""))
    return total


def _apply_token_budget(
    messages: list[dict[str, Any]],
    token_budget: int,
) -> tuple[list[dict[str, Any]], dict[str, int] | None]:
    budget = max(256, int(token_budget or 0))
    original_tokens = _messages_token_count(messages)
    if original_tokens <= budget:
        return messages, None
    kept: list[dict[str, Any]] = []
    running = 0
    for row in reversed(messages):
        row_tokens = _messages_token_count([row])
        if kept and running + row_tokens > budget:
            break
        kept.append(row)
        running += row_tokens
    kept.reverse()
    if not kept:
        kept = messages[-1:]
        running = _messages_token_count(kept)
    return kept, {"originalTokens": original_tokens, "usedTokens": running}


def _resolve_model_info(settings: Settings) -> tuple[str | None, int | None]:
    configured_model_id = normalize_model_id(settings.llm_model)
    resolved_model_id = configured_model_id
    context_window: int | None = None

    try:
        model = create_chat_model(settings)
    except Exception:
        model = None

    if model is not None:
        for attr in ("model_name", "model", "model_id"):
            value = getattr(model, attr, None)
            normalized = normalize_model_id(value if isinstance(value, str) else None)
            if normalized:
                resolved_model_id = normalized
                break

        for attr in ("profile", "model_profile"):
            context_window = max_input_tokens_from_profile(getattr(model, attr, None))
            if context_window is not None:
                break

        if context_window is None:
            context_window = to_int(getattr(model, "max_input_tokens", None))

    if context_window is None and resolved_model_id:
        context_window = context_window_fallback(resolved_model_id)
    if context_window is None and configured_model_id:
        context_window = context_window_fallback(configured_model_id)

    return (resolved_model_id, context_window)


def _make_config(payload: ChatRequest) -> dict:
    thread_id = payload.thread_id or str(uuid.uuid4())
    return {"configurable": {"thread_id": thread_id}}


def _project_id(payload: ChatRequest) -> str:
    return payload.project_id or "default"


def _latest_user_message_text(payload: ChatRequest) -> str:
    for message in reversed(payload.messages):
        if message.role.value == "user" and message.content.strip():
            return message.content.strip()
    return ""


def _normalize_request_text(request_text: str) -> str:
    return re.sub(r"\s+", " ", request_text.lower()).strip()


def _contains_term(text: str, term: str) -> bool:
    return re.search(rf"\b{re.escape(term)}\b", text) is not None


def _contains_any_term(text: str, terms: tuple[str, ...]) -> bool:
    return any(_contains_term(text, term) for term in terms)


def _starts_with_term(text: str, terms: tuple[str, ...]) -> bool:
    return any(text == term or text.startswith(f"{term} ") for term in terms)


def _is_request_like(text: str, actions: tuple[str, ...]) -> bool:
    return _starts_with_term(text, actions) or _contains_any_term(text, _REQUEST_HINTS)


def _matches_action_request(text: str, actions: tuple[str, ...], targets: tuple[str, ...]) -> bool:
    return _is_request_like(text, actions) and _contains_any_term(text, actions) and _contains_any_term(text, targets)


def _matches_blueprint_reference_request(text: str, targets: tuple[str, ...]) -> bool:
    return (
        _is_request_like(text, _BLUEPRINT_SUGGESTION_ACTIONS)
        and _contains_any_term(text, _BLUEPRINT_REFERENCE_TERMS)
        and _contains_any_term(text, targets)
    )


def _blueprint_kind_for_request(request_text: str) -> str | None:
    lowered = _normalize_request_text(request_text)
    if not lowered:
        return None
    if _matches_action_request(lowered, _CONFIGURATION_HOST_ACTIONS, _CONFIGURATION_HOST_TARGETS):
        return "configuration"
    if _matches_action_request(lowered, _CONFIGURATION_SOFTWARE_ACTIONS, _CONFIGURATION_SOFTWARE_TARGETS):
        return "configuration"
    if _matches_action_request(lowered, _CONFIGURATION_GENERATE_ACTIONS, _CONFIGURATION_GENERATE_TARGETS):
        return "configuration"
    if _matches_blueprint_reference_request(
        lowered,
        _CONFIGURATION_SOFTWARE_TARGETS + _CONFIGURATION_GENERATE_TARGETS,
    ):
        return "configuration"
    if _matches_action_request(lowered, _PROVISIONING_ACTIONS, _PROVISIONING_TARGETS):
        return "provisioning"
    if _matches_blueprint_reference_request(lowered, _PROVISIONING_TARGETS):
        return "provisioning"
    return None


def _blueprint_input_payload(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "key": item["key"],
        "label": item["label"],
        "required": bool(item.get("required", False)),
        "riskClass": item.get("risk_class", "safe"),
        "defaultValue": item.get("default_value"),
        "resolved": bool(item.get("resolved", False)),
        "value": item.get("value"),
    }


def _blueprint_step_payload(step: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": step["id"],
        "type": step["type"],
        "title": step["title"],
        "description": step["description"],
        "requiredInputs": list(step.get("required_inputs", [])),
        "expectedResult": step["expected_result"],
    }


def _blueprint_payload(definition: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": definition["id"],
        "kind": definition["kind"],
        "name": definition["name"],
        "summary": definition["summary"],
        "resourcesOrActions": list(definition.get("resources_or_actions", [])),
        "requiredInputs": [_blueprint_input_payload(item) for item in definition.get("required_inputs", [])],
        "steps": [_blueprint_step_payload(step) for step in definition.get("steps", [])],
    }


def _selection_has_unresolved_required_inputs(selection: dict[str, Any]) -> bool:
    for item in selection.get("required_inputs", []):
        if item.get("required") and not item.get("resolved"):
            return True
    return False


def _blueprint_suggestions_event(request_text: str, kind: str) -> dict[str, Any]:
    suggestions = blueprint_service.rank_blueprints_for_request(request_text, kind, limit=3)
    return {
        "type": "blueprint.suggestions",
        "kind": kind,
        "suggestions": [_blueprint_payload(item) for item in suggestions],
    }


def _selection_provenance_event(kind: str, selection: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "blueprint.provenance",
        "kind": kind,
        "source": "selection",
        "runId": selection.get("latest_run_id"),
        "createdAt": selection.get("latest_run_created_at"),
        "inputs": dict(selection.get("inputs", {})),
        "blueprint": _blueprint_payload(
            {
                "id": selection["blueprint_id"],
                "kind": selection["kind"],
                "name": selection["blueprint_name"],
                "summary": selection["summary"],
                "resources_or_actions": selection.get("resources_or_actions", []),
                "required_inputs": selection.get("required_inputs", []),
                "steps": selection.get("steps", []),
            }
        ),
    }


def _run_provenance_event(kind: str, run: Any) -> dict[str, Any]:
    snapshot = run.snapshot_json if isinstance(run.snapshot_json, dict) else {}
    return {
        "type": "blueprint.provenance",
        "kind": kind,
        "source": "run",
        "runId": run.id,
        "createdAt": run.created_at.isoformat() if run.created_at else None,
        "inputs": dict(run.inputs_json or {}),
        "blueprint": _blueprint_payload(snapshot),
    }


def _blueprint_inputs_summary_event(kind: str, selection: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "blueprint.inputs.summary",
        "kind": kind,
        "blueprintId": selection["blueprint_id"],
        "blueprintName": selection["blueprint_name"],
        "inputs": [_blueprint_input_payload(item) for item in selection.get("required_inputs", [])],
    }


async def _load_blueprint_preflight(
    payload: ChatRequest,
    request_text: str,
) -> tuple[list[dict[str, Any]], bool]:
    project_id = payload.project_id
    if not project_id:
        return ([], True)
    kind = _blueprint_kind_for_request(request_text)
    if kind is None:
        return ([], True)
    async with db.get_session() as session:
        project = await session.get(Project, project_id)
        if project is None:
            return ([], True)
        active = blueprint_service.get_active_blueprints(project).get(kind)
        if active is None:
            return ([_blueprint_suggestions_event(request_text, kind)], False)
        run_id = active.get("latest_run_id")
        if run_id:
            run = await blueprint_service.get_blueprint_run(session, project_id, run_id)
            if run is not None:
                events = [_run_provenance_event(kind, run)]
            else:
                events = [_selection_provenance_event(kind, active)]
        else:
            events = [_selection_provenance_event(kind, active)]
    if _selection_has_unresolved_required_inputs(active):
        events.append(_blueprint_inputs_summary_event(kind, active))
        return (events, False)
    return (events, True)


def _tool_start_event(tool_call: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "tool.start",
        "toolCallId": tool_call["toolCallId"],
        "toolName": tool_call["toolName"],
        "args": tool_call["args"],
        "argsText": tool_call["argsText"],
    }


def _update_usage_from_ai_message(message: AIMessage, usage_state: dict[str, tuple[int, int] | None]) -> None:
    extracted_usage = extract_usage_from_message(message)
    if extracted_usage is not None:
        usage_state["tokens"] = extracted_usage


def _ai_message_events(
    message: AIMessage,
    seen_tool_calls: set[str],
    tool_call_map: dict[str, dict[str, Any]],
    usage_state: dict[str, tuple[int, int] | None],
    state: dict[str, Any],
    *,
    max_tool_calls: int,
    correlation_id: str,
) -> list[dict[str, Any]]:
    _update_usage_from_ai_message(message, usage_state)
    events: list[dict[str, Any]] = []
    for tool_call in normalize_tool_calls(message):
        if state["tool_call_count"] >= max_tool_calls:
            state["interrupted"] = True
            events.append(
                {
                    "type": "incident.action.blocked",
                    "correlationId": correlation_id,
                    "incidentKey": "chat-tool-budget",
                    "recommendedAction": "tool_call_budget_exceeded",
                    "reason": "max_tool_calls_exceeded",
                }
            )
            break
        tool_call_id = tool_call["toolCallId"]
        if tool_call_id in seen_tool_calls:
            continue
        seen_tool_calls.add(tool_call_id)
        tool_call_map[tool_call_id] = tool_call
        state["tool_call_count"] += 1
        events.append(_tool_start_event(tool_call))
    return events


def _tool_result_candidates(tool_result: dict[str, Any], tool_args: dict[str, Any]) -> list[str]:
    candidates: list[str] = []
    result = tool_result.get("result")
    if isinstance(result, dict):
        result_path = result.get("path")
        if isinstance(result_path, str) and result_path:
            candidates.append(result_path)
    arg_path = tool_args.get("path")
    if isinstance(arg_path, str) and arg_path:
        candidates.append(arg_path)
    return candidates


def _tool_result_event(
    tool_result: dict[str, Any], tool_name: str, tool_args: dict[str, Any], tool_args_text: str
) -> dict[str, Any]:
    artifact = tool_result["result"].get("artifact") if isinstance(tool_result["result"], dict) else None
    return {
        "type": "tool.result",
        "toolCallId": tool_result["toolCallId"],
        "toolName": tool_name,
        "args": tool_args,
        "argsText": tool_args_text,
        "result": tool_result["result"],
        "isError": tool_result["isError"],
        "artifact": artifact,
    }


def _file_event_from_artifact(artifact: Any) -> dict[str, Any] | None:
    if not isinstance(artifact, dict) or not artifact.get("dataBase64"):
        return None
    return {
        "type": "file",
        "filename": artifact.get("filename"),
        "mimeType": artifact.get("mimeType"),
        "dataBase64": artifact.get("dataBase64"),
    }


def _tool_message_events(
    message: ToolMessage,
    tool_call_map: dict[str, dict[str, Any]],
    changed_paths: set[str],
) -> list[dict[str, Any]]:
    tool_result = parse_tool_result(message)
    tool_meta = tool_call_map.get(tool_result["toolCallId"], {})
    tool_name = str(tool_meta.get("toolName") or "tool")
    tool_args = tool_meta.get("args") if isinstance(tool_meta.get("args"), dict) else {}
    tool_args_text = str(tool_meta.get("argsText") or "")
    if tool_name in {"write_file", "edit_file", "delete_file"}:
        changed_paths.update(_tool_result_candidates(tool_result, tool_args))

    result_event = _tool_result_event(tool_result, tool_name, tool_args, tool_args_text)
    artifact_event = _file_event_from_artifact(result_event["artifact"])
    return [result_event] + ([artifact_event] if artifact_event else [])


def _usage_event(
    usage_tokens: tuple[int, int] | None,
    *,
    model_id: str | None,
    model_context_window: int | None,
) -> dict[str, Any]:
    prompt_tokens, completion_tokens = usage_tokens or (0, 0)
    estimated_cost = round((prompt_tokens * 0.00000015) + (completion_tokens * 0.0000006), 8)
    return {
        "type": "usage",
        "promptTokens": prompt_tokens,
        "completionTokens": completion_tokens,
        "modelId": model_id,
        "modelContextWindow": model_context_window,
        "estimatedCostUsd": estimated_cost,
    }


async def _policy_result_event(project_id: str) -> dict[str, Any]:
    try:
        checks = await policy_checks.run_project_policy_checks(project_id)
    except Exception as exc:
        checks = {
            "issues": [],
            "summary": {"total": 0, "bySeverity": {}},
            "scanError": {"code": "policy_check_failed", "message": str(exc) or "Policy checks failed"},
        }
    return {
        "type": "policy.check.result",
        "issues": checks.get("issues", []),
        "summary": checks.get("summary", {"total": 0, "bySeverity": {}}),
        "scanError": checks.get("scanError"),
    }


def _policy_incident_events(
    *,
    summary: dict[str, Any],
    correlation_id: str,
    threshold: float,
) -> list[dict[str, Any]]:
    by = summary.get("bySeverity") if isinstance(summary, dict) else {}
    by_severity = by if isinstance(by, dict) else {}
    total = int(summary.get("total", 0) or 0)
    critical = int(by_severity.get("CRITICAL", 0) or 0)
    high = int(by_severity.get("HIGH", 0) or 0)
    severity = "critical" if critical > 0 else ("high" if high > 0 else ("medium" if total > 0 else "low"))
    confidence = round(min(0.95, 0.35 + (total * 0.03) + (critical * 0.15) + (high * 0.08)), 3)
    recommended_action = "run_policy_fix_after_review" if severity in {"critical", "high"} else "monitor_and_review"
    approval_required = severity in {"critical", "high"} and confidence >= threshold
    analysis_only = confidence < threshold
    if analysis_only:
        recommended_action = "analysis_only"
        approval_required = False
    return [
        {
            "type": "incident.classified",
            "correlationId": correlation_id,
            "incidentKey": "policy-check",
            "severity": severity,
            "confidence": confidence,
            "evidence": [{"type": "policy_issues", "count": total}],
        },
        {
            "type": "incident.recommendation",
            "correlationId": correlation_id,
            "incidentKey": "policy-check",
            "severity": severity,
            "confidence": confidence,
            "recommendedAction": recommended_action,
            "approvalRequired": approval_required,
            "actionClass": "approval_required" if approval_required else "safe",
            "analysisOnly": analysis_only,
        },
    ]


async def _emit_policy_events(
    project_id: str,
    changed_paths: set[str],
    *,
    correlation_id: str,
    settings: Settings,
) -> AsyncIterator[dict[str, Any]]:
    if not changed_paths:
        return
    sorted_paths = sorted(changed_paths)
    yield {"type": "policy.check.start", "changedPaths": sorted_paths}
    result_event = await _policy_result_event(project_id)
    payload = {**result_event, "changedPaths": sorted_paths}
    yield payload
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    for event in _policy_incident_events(
        summary=summary,
        correlation_id=correlation_id,
        threshold=float(settings.incident_confidence_threshold or 0.7),
    ):
        yield event


def _new_stream_state(*, correlation_id: str) -> dict[str, Any]:
    return {
        "seen_tool_calls": set(),
        "tool_call_map": {},
        "changed_paths": set(),
        "buffers": {"text": "", "reasoning": ""},
        "usage_state": {"tokens": None},
        "interrupted": False,
        "tool_call_count": 0,
        "correlation_id": correlation_id,
    }


async def _stream_agent_events(
    agent: Any,
    *,
    messages: list[dict[str, Any]],
    config: dict[str, Any],
    cancel_checker: CancelChecker | None,
    state: dict[str, Any],
    max_tool_calls: int,
) -> AsyncIterator[dict[str, Any]]:
    async for chunk in agent.astream({"messages": messages}, config, stream_mode=["messages", "updates"]):
        if state["interrupted"]:
            break
        if cancel_checker is not None and await cancel_checker():
            state["interrupted"] = True
            break
        for message in extract_messages_from_obj(chunk):
            if isinstance(message, AIMessage):
                for event in _ai_message_events(
                    message,
                    state["seen_tool_calls"],
                    state["tool_call_map"],
                    state["usage_state"],
                    state,
                    max_tool_calls=max(1, max_tool_calls),
                    correlation_id=str(state["correlation_id"]),
                ):
                    yield event
                if state["interrupted"]:
                    break
                for event in extract_text_events(message, state["buffers"]):
                    yield event
                continue
            if isinstance(message, ToolMessage):
                for event in _tool_message_events(message, state["tool_call_map"], state["changed_paths"]):
                    yield event
                continue
            for event in extract_text_events(message, state["buffers"]):
                yield event


async def stream_response_events(
    payload: ChatRequest,
    settings: Settings,
    *,
    cancel_checker: CancelChecker | None = None,
) -> AsyncIterator[dict[str, Any]]:
    ensure_settings(settings)
    ensure_payload(payload)
    request_text = _latest_user_message_text(payload)
    preflight_events, can_continue = await _load_blueprint_preflight(payload, request_text)
    correlation_id = str(uuid.uuid4())
    messages, compaction = _apply_token_budget(
        _to_langchain_messages(payload),
        int(settings.incident_token_budget or 16000),
    )
    if compaction:
        yield {
            "type": "incident.context.compacted",
            "correlationId": correlation_id,
            "incidentKey": "chat-token-budget",
            **compaction,
        }
    for event in preflight_events:
        yield event
    if not can_continue:
        return
    agent = await get_agent(settings, _project_id(payload))
    config = _make_config(payload)
    state = _new_stream_state(correlation_id=correlation_id)
    model_id, model_context_window = _resolve_model_info(settings)

    async for event in _stream_agent_events(
        agent,
        messages=messages,
        config=config,
        cancel_checker=cancel_checker,
        state=state,
        max_tool_calls=max(1, int(settings.agent_max_tool_calls or 25)),
    ):
        yield event

    if state["interrupted"]:
        return
    if cancel_checker is not None and await cancel_checker():
        return

    async for event in _emit_policy_events(
        _project_id(payload),
        state["changed_paths"],
        correlation_id=correlation_id,
        settings=settings,
    ):
        yield event

    if cancel_checker is not None and await cancel_checker():
        return

    yield _usage_event(state["usage_state"]["tokens"], model_id=model_id, model_context_window=model_context_window)


async def generate_response(payload: ChatRequest, settings: Settings) -> str:
    ensure_settings(settings)
    ensure_payload(payload)
    agent = await get_agent(settings, _project_id(payload))
    messages, _ = _apply_token_budget(_to_langchain_messages(payload), int(settings.incident_token_budget or 16000))
    config = _make_config(payload)

    result = await run_in_threadpool(agent.invoke, {"messages": messages}, config)

    if isinstance(result, dict) and result.get("messages"):
        last = result["messages"][-1]
        return text_from_content(getattr(last, "content", ""))

    return str(result)


async def generate_basic_response(payload: ChatRequest, settings: Settings) -> str:
    """Guest-mode chat without tools or project persistence."""
    ensure_settings(settings)
    ensure_payload(payload)
    model = create_chat_model(settings)
    messages, _ = _apply_token_budget(_to_langchain_messages(payload), int(settings.incident_token_budget or 16000))
    result = await run_in_threadpool(model.invoke, messages)
    if isinstance(result, BaseMessage):
        return text_from_content(getattr(result, "content", ""))
    return str(result)


async def stream_response(
    payload: ChatRequest,
    settings: Settings,
    request: Request,
) -> AsyncIterator[dict[str, Any]]:
    async for event in stream_response_events(
        payload,
        settings,
        cancel_checker=request.is_disconnected,
    ):
        yield event


async def stream_basic_response(
    payload: ChatRequest,
    settings: Settings,
    request: Request,
) -> AsyncIterator[dict[str, Any]]:
    del request
    text = await generate_basic_response(payload, settings)
    if text:
        yield {"type": "text.delta", "delta": text}
