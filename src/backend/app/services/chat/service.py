from __future__ import annotations

import uuid
from typing import Any, AsyncIterator

from fastapi import HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from langchain_core.messages import AIMessage, BaseMessage, ToolMessage

from app.core.config import Settings
from app.schemas.chat import ChatRequest
from app.services.policy import checks as policy_checks
from app.services.agent import get_agent
from app.services.model.factory import create_chat_model

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


def ensure_settings(settings: Settings) -> None:
    if not settings.google_api_key:
        raise HTTPException(status_code=500, detail="GOOGLE_API_KEY is not set")


def ensure_payload(payload: ChatRequest) -> None:
    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages are required")


def _to_langchain_messages(request: ChatRequest) -> list[dict]:
    return [{"role": message.role, "content": message.content} for message in request.messages]


def _resolve_model_info(settings: Settings) -> tuple[str | None, int | None]:
    configured_model_id = normalize_model_id(settings.gemini_model)
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


async def generate_response(payload: ChatRequest, settings: Settings) -> str:
    ensure_settings(settings)
    ensure_payload(payload)
    agent = await get_agent(settings, _project_id(payload))
    messages = _to_langchain_messages(payload)
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
    result = await run_in_threadpool(model.invoke, _to_langchain_messages(payload))
    if isinstance(result, BaseMessage):
        return text_from_content(getattr(result, "content", ""))
    return str(result)


async def stream_response(
    payload: ChatRequest,
    settings: Settings,
    request: Request,
) -> AsyncIterator[dict[str, Any]]:
    ensure_settings(settings)
    ensure_payload(payload)
    agent = await get_agent(settings, _project_id(payload))
    messages = _to_langchain_messages(payload)
    config = _make_config(payload)
    seen_tool_calls: set[str] = set()
    tool_call_map: dict[str, dict[str, Any]] = {}
    changed_paths: set[str] = set()
    buffers = {"text": "", "reasoning": ""}
    stream_interrupted = False
    usage_tokens: tuple[int, int] | None = None
    model_id, model_context_window = _resolve_model_info(settings)

    async for chunk in agent.astream(
        {"messages": messages},
        config,
        stream_mode=["messages", "updates"],
    ):
        if await request.is_disconnected():
            stream_interrupted = True
            break

        for message in extract_messages_from_obj(chunk):
            if isinstance(message, AIMessage):
                extracted_usage = extract_usage_from_message(message)
                if extracted_usage is not None:
                    usage_tokens = extracted_usage

                for tool_call in normalize_tool_calls(message):
                    tool_call_id = tool_call["toolCallId"]
                    if tool_call_id in seen_tool_calls:
                        continue
                    seen_tool_calls.add(tool_call_id)
                    tool_call_map[tool_call_id] = tool_call
                    yield {
                        "type": "tool.start",
                        "toolCallId": tool_call_id,
                        "toolName": tool_call["toolName"],
                        "args": tool_call["args"],
                        "argsText": tool_call["argsText"],
                    }
            if isinstance(message, ToolMessage):
                tool_result = parse_tool_result(message)
                tool_meta = tool_call_map.get(tool_result["toolCallId"], {})
                tool_name = str(tool_meta.get("toolName") or "tool")
                tool_args = tool_meta.get("args") or {}
                tool_args_text = tool_meta.get("argsText") or ""
                artifact = None
                if isinstance(tool_result["result"], dict):
                    artifact = tool_result["result"].get("artifact")
                if tool_name in {"write_file", "edit_file", "delete_file"}:
                    candidates: list[str] = []
                    if isinstance(tool_result["result"], dict):
                        result_path = tool_result["result"].get("path")
                        if isinstance(result_path, str) and result_path:
                            candidates.append(result_path)
                    if isinstance(tool_args, dict):
                        arg_path = tool_args.get("path")
                        if isinstance(arg_path, str) and arg_path:
                            candidates.append(arg_path)
                    for candidate in candidates:
                        changed_paths.add(candidate)
                yield {
                    "type": "tool.result",
                    "toolCallId": tool_result["toolCallId"],
                    "toolName": tool_name,
                    "args": tool_args,
                    "argsText": tool_args_text,
                    "result": tool_result["result"],
                    "isError": tool_result["isError"],
                    "artifact": artifact,
                }
                if isinstance(artifact, dict) and artifact.get("dataBase64"):
                    yield {
                        "type": "file",
                        "filename": artifact.get("filename"),
                        "mimeType": artifact.get("mimeType"),
                        "dataBase64": artifact.get("dataBase64"),
                    }
                continue

            for event in extract_text_events(message, buffers):
                yield event

    if stream_interrupted or await request.is_disconnected():
        return

    if changed_paths:
        sorted_paths = sorted(changed_paths)
        yield {
            "type": "policy.check.start",
            "changedPaths": sorted_paths,
        }

        try:
            checks = await policy_checks.run_project_policy_checks(_project_id(payload))
        except Exception as exc:
            checks = {
                "issues": [],
                "summary": {"total": 0, "bySeverity": {}},
                "scanError": {"code": "policy_check_failed", "message": str(exc) or "Policy checks failed"},
            }
        yield {
            "type": "policy.check.result",
            "issues": checks.get("issues", []),
            "summary": checks.get("summary", {"total": 0, "bySeverity": {}}),
            "scanError": checks.get("scanError"),
            "changedPaths": sorted_paths,
        }

    if await request.is_disconnected():
        return

    prompt_tokens, completion_tokens = usage_tokens or (0, 0)
    yield {
        "type": "usage",
        "promptTokens": prompt_tokens,
        "completionTokens": completion_tokens,
        "modelId": model_id,
        "modelContextWindow": model_context_window,
    }


async def stream_basic_response(
    payload: ChatRequest,
    settings: Settings,
    request: Request,
) -> AsyncIterator[dict[str, Any]]:
    del request
    text = await generate_basic_response(payload, settings)
    if text:
        yield {"type": "text.delta", "delta": text}
