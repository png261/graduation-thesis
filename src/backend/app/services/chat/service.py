from __future__ import annotations

import logging
import uuid
from pathlib import Path
from typing import Any, AsyncIterator, Awaitable, Callable

from fastapi import HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from langchain_core.messages import AIMessage, ToolMessage
from openai import APIConnectionError, APIStatusError, APITimeoutError

from app.core.config import Settings
from app.schemas.chat import ChatAttachment, ChatMessage, ChatRequest, ChatRole
from app.services.agent import get_agent
from app.services.agent.runtime.context import DeepAgentContext, build_infra_cost_context, build_runtime_context
from app.services.opentofu import deploy as opentofu_deploy
from app.services.policy import checks as policy_checks

from .evidence_bundle import extract_evidence_bundle_event
from .streaming_helpers import (
    extract_messages_from_obj,
    extract_text_events,
    normalize_tool_calls,
    parse_tool_result,
)

CancelChecker = Callable[[], Awaitable[bool]]
logger = logging.getLogger(__name__)

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
_TRANSPORT_FAILURE_TERMS = (
    "no route to host",
    "network is unreachable",
    "connection refused",
    "dial tcp",
    "connect:",
    "timeout",
    "timed out",
)


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


def _text_from_content(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text", "")))
        return "".join(parts)
    return ""


def _resolved_thread_id(payload: ChatRequest) -> str:
    return payload.thread_id or str(uuid.uuid4())


def _make_config(thread_id: str) -> dict:
    return {"configurable": {"thread_id": thread_id}}


async def _load_runtime_cost_context(project_id: str):
    try:
        payload = opentofu_deploy.peek_cached_costs(
            project_id=project_id,
            module_scope="all",
        )
    except Exception:
        logger.warning("failed to load runtime cost context project_id=%s", project_id, exc_info=True)
        return None
    return build_infra_cost_context(payload) if isinstance(payload, dict) else None


async def _make_agent_run_payload(payload: ChatRequest) -> tuple[dict, DeepAgentContext]:
    thread_id = _resolved_thread_id(payload)
    infra_cost = await _load_runtime_cost_context(_project_id(payload))
    return _make_config(thread_id), build_runtime_context(payload, thread_id=thread_id, infra_cost=infra_cost)


def _project_id(payload: ChatRequest) -> str:
    return payload.project_id or "default"


def _tool_start_event(tool_call: dict[str, Any]) -> dict[str, Any]:
    event = {
        "type": "tool.start",
        "toolCallId": tool_call["toolCallId"],
        "toolName": tool_call["toolName"],
        "args": tool_call["args"],
        "argsText": tool_call["argsText"],
    }
    if tool_call.get("schemaVersion") is not None:
        event["schemaVersion"] = tool_call["schemaVersion"]
    if tool_call.get("sourceTool"):
        event["sourceTool"] = tool_call["sourceTool"]
    return event


def _has_meaningful_tool_name(name: Any) -> bool:
    return isinstance(name, str) and bool(name.strip()) and name != "tool"


def _has_meaningful_tool_args(args: Any) -> bool:
    return isinstance(args, dict) and len(args) > 0


def _has_meaningful_args_text(args_text: Any) -> bool:
    return isinstance(args_text, str) and args_text.strip() not in {"", "{}", "null"}


def _merge_tool_call(existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    merged = {**existing, **incoming}
    merged["toolName"] = (
        incoming["toolName"]
        if _has_meaningful_tool_name(incoming.get("toolName"))
        else existing.get("toolName") or incoming.get("toolName") or "tool"
    )
    merged["args"] = (
        incoming["args"]
        if _has_meaningful_tool_args(incoming.get("args"))
        else existing.get("args") or incoming.get("args") or {}
    )
    merged["argsText"] = (
        incoming["argsText"]
        if _has_meaningful_args_text(incoming.get("argsText"))
        else existing.get("argsText") or incoming.get("argsText") or "{}"
    )
    return merged


def _ai_message_events(
    message: AIMessage,
    seen_tool_calls: set[str],
    tool_call_map: dict[str, dict[str, Any]],
    state: dict[str, Any],
    *,
    max_tool_calls: int,
    correlation_id: str,
) -> list[dict[str, Any]]:
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
            previous = tool_call_map.get(tool_call_id, {})
            merged = _merge_tool_call(previous, tool_call)
            tool_call_map[tool_call_id] = merged
            if merged != previous:
                events.append(_tool_start_event(merged))
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
    event = {
        "type": "tool.result",
        "toolCallId": tool_result["toolCallId"],
        "toolName": tool_name,
        "args": tool_args,
        "argsText": tool_args_text,
        "result": tool_result["result"],
        "isError": tool_result["isError"],
        "artifact": artifact,
    }
    if tool_result.get("schemaVersion") is not None:
        event["schemaVersion"] = tool_result["schemaVersion"]
    if tool_result.get("sourceTool"):
        event["sourceTool"] = tool_result["sourceTool"]
    if tool_result.get("severity"):
        event["severity"] = tool_result["severity"]
    if tool_result.get("fixClass"):
        event["fixClass"] = tool_result["fixClass"]
    if tool_result.get("diagnostic"):
        event["diagnostic"] = tool_result["diagnostic"]
    return event


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
        "interrupted": False,
        "tool_call_count": 0,
        "correlation_id": correlation_id,
    }


def _provider_error_text(exc: APIStatusError) -> str | None:
    body = exc.body
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict):
            raw_message = error.get("message")
            if isinstance(raw_message, str) and raw_message.strip():
                return raw_message.strip()
    message = str(exc).strip()
    return message or None


def _looks_like_transport_failure(message: str | None) -> bool:
    if not message:
        return False
    lowered = message.lower()
    return any(term in lowered for term in _TRANSPORT_FAILURE_TERMS)


def _provider_error_payload(exc: Exception) -> tuple[int, dict[str, Any]] | None:
    if isinstance(exc, APITimeoutError):
        return 504, {
            "code": "provider_timeout",
            "message": "The language model timed out. Please retry.",
            "details": {"retryable": True},
        }
    if isinstance(exc, APIConnectionError):
        return 503, {
            "code": "provider_unavailable",
            "message": "The language model provider is temporarily unreachable. Please retry.",
            "details": {"retryable": True},
        }
    if not isinstance(exc, APIStatusError):
        return None
    raw_message = _provider_error_text(exc)
    retryable = (
        exc.status_code in {408, 409, 429} or exc.status_code >= 500 or _looks_like_transport_failure(raw_message)
    )
    code, status_code, message = "provider_request_failed", 502, raw_message or "The language model request failed."
    if exc.status_code == 429:
        code, status_code, message = "provider_rate_limited", 429, "The language model is rate limited. Please retry."
    elif retryable:
        code, status_code, message = (
            "provider_unavailable",
            503,
            "The language model provider is temporarily unavailable. Please retry.",
        )
    details: dict[str, Any] = {"retryable": retryable, "providerStatusCode": exc.status_code}
    if raw_message and message != raw_message:
        details["providerMessage"] = raw_message
    return status_code, {"code": code, "message": message, "details": details}


def _raise_provider_http_error(exc: Exception) -> None:
    payload = _provider_error_payload(exc)
    if payload is None:
        raise exc
    status_code, detail = payload
    logger.warning("chat model request failed", exc_info=exc)
    raise HTTPException(status_code=status_code, detail=detail)


async def _stream_agent_events(
    agent: Any,
    *,
    messages: list[dict[str, Any]],
    config: dict[str, Any],
    context: DeepAgentContext,
    cancel_checker: CancelChecker | None,
    state: dict[str, Any],
    max_tool_calls: int,
) -> AsyncIterator[dict[str, Any]]:
    async for chunk in agent.astream(
        {"messages": messages},
        config,
        context=context,
        stream_mode=["messages", "updates"],
    ):
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
    agent = await get_agent(settings, _project_id(payload))
    config, runtime_context = await _make_agent_run_payload(payload)
    state = _new_stream_state(correlation_id=correlation_id)

    try:
        async for event in _stream_agent_events(
            agent,
            messages=messages,
            config=config,
            context=runtime_context,
            cancel_checker=cancel_checker,
            state=state,
            max_tool_calls=max(1, int(settings.agent_max_tool_calls or 25)),
        ):
            yield event
    except Exception as exc:
        payload = _provider_error_payload(exc)
        if payload is None:
            raise
        _, error_event = payload
        logger.warning("chat stream failed", exc_info=exc)
        yield {"type": "error", **error_event}
        return

    if state["interrupted"]:
        return
    if cancel_checker is not None and await cancel_checker():
        return

    evidence_bundle_event = extract_evidence_bundle_event(state["buffers"]["text"])
    if evidence_bundle_event is not None:
        yield evidence_bundle_event

    async for event in _emit_policy_events(
        _project_id(payload),
        state["changed_paths"],
        correlation_id=correlation_id,
        settings=settings,
    ):
        yield event

    if cancel_checker is not None and await cancel_checker():
        return


async def generate_response(payload: ChatRequest, settings: Settings) -> str:
    ensure_settings(settings)
    ensure_payload(payload)
    agent = await get_agent(settings, _project_id(payload))
    messages, _ = _apply_token_budget(_to_langchain_messages(payload), int(settings.incident_token_budget or 16000))
    config, runtime_context = await _make_agent_run_payload(payload)
    try:
        result = await run_in_threadpool(agent.invoke, {"messages": messages}, config, context=runtime_context)
    except Exception as exc:
        _raise_provider_http_error(exc)

    if isinstance(result, dict) and result.get("messages"):
        last = result["messages"][-1]
        return _text_from_content(getattr(last, "content", ""))

    return str(result)


async def generate_basic_response(payload: ChatRequest, settings: Settings) -> str:
    return await generate_response(payload, settings)


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
