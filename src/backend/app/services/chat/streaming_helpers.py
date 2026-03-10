from __future__ import annotations

import json
from typing import Any

from langchain_core.messages import BaseMessage, ToolMessage


def extract_messages_from_obj(obj: object) -> list[BaseMessage]:
    messages: list[BaseMessage] = []
    if isinstance(obj, BaseMessage):
        return [obj]
    if isinstance(obj, dict):
        for value in obj.values():
            messages.extend(extract_messages_from_obj(value))
        return messages
    if isinstance(obj, (list, tuple)):
        for item in obj:
            messages.extend(extract_messages_from_obj(item))
    return messages


def _is_chunk(message: BaseMessage) -> bool:
    return message.__class__.__name__.endswith("Chunk")


def _append_delta(buffer: dict[str, str], key: str, content: str, is_chunk: bool) -> str | None:
    if not content:
        return None
    current = buffer.get(key, "")
    if content.startswith(current):
        delta = content[len(current) :]
        if delta:
            buffer[key] = content
            return delta
        return None
    if is_chunk:
        buffer[key] = current + content
        return content
    if content != current:
        buffer[key] = content
        return content
    return None


def extract_text_events(message: BaseMessage, buffer: dict[str, str]) -> list[dict[str, Any]]:
    content = getattr(message, "content", "")
    is_chunk = _is_chunk(message)
    events: list[dict[str, Any]] = []

    if isinstance(content, list):
        for item in content:
            if not isinstance(item, dict):
                continue
            part_type = item.get("type")
            part_text = str(item.get("text", ""))
            if part_type == "reasoning":
                delta = _append_delta(buffer, "reasoning", part_text, is_chunk)
                if delta:
                    events.append({"type": "reasoning.delta", "delta": delta})
            elif part_type == "text":
                delta = _append_delta(buffer, "text", part_text, is_chunk)
                if delta:
                    events.append({"type": "text.delta", "delta": delta})
        return events

    if isinstance(content, str):
        delta = _append_delta(buffer, "text", content, is_chunk)
        if delta:
            events.append({"type": "text.delta", "delta": delta})
    return events


def normalize_tool_calls(message: BaseMessage) -> list[dict[str, Any]]:
    tool_calls = getattr(message, "tool_calls", None)
    if tool_calls is None:
        tool_calls = getattr(message, "additional_kwargs", {}).get("tool_calls")
    if not tool_calls:
        return []

    normalized: list[dict[str, Any]] = []
    for call in tool_calls:
        if isinstance(call, dict):
            tool_call_id = call.get("id") or call.get("tool_call_id")
            name = call.get("name")
            args = call.get("args")
            args_text = call.get("args_text")

            function = call.get("function")
            if isinstance(function, dict):
                name = name or function.get("name")
                args_text = args_text or function.get("arguments")
        else:
            tool_call_id = getattr(call, "id", None) or getattr(call, "tool_call_id", None)
            name = getattr(call, "name", None) or getattr(call, "tool_name", None)
            args = getattr(call, "args", None)
            args_text = getattr(call, "args_text", None)

        if args is None and isinstance(args_text, str):
            try:
                args = json.loads(args_text)
            except json.JSONDecodeError:
                args = {"raw": args_text}

        if args_text is None:
            try:
                args_text = json.dumps(args or {}, ensure_ascii=False)
            except TypeError:
                args_text = str(args)

        normalized.append(
            {
                "toolCallId": tool_call_id or f"tool-{len(normalized)}",
                "toolName": name or "tool",
                "args": args or {},
                "argsText": args_text or "",
            }
        )
    return normalized


def parse_tool_result(message: ToolMessage) -> dict[str, Any]:
    content = getattr(message, "content", None)
    result: Any = content
    if isinstance(content, str):
        try:
            result = json.loads(content)
        except json.JSONDecodeError:
            result = content
    return {
        "toolCallId": getattr(message, "tool_call_id", None) or "tool",
        "result": result,
        "isError": False,
    }
