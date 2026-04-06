from __future__ import annotations

import json
from collections.abc import AsyncIterator, Callable
from typing import Any

from sse_starlette import EventSourceResponse

_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def sse_json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False)


def normalize_sse_item(item: Any) -> str:
    if isinstance(item, dict):
        if "data" in item:
            data = item.get("data")
            if isinstance(data, str):
                return data
            return json.dumps(data, ensure_ascii=False)
        return sse_json(item)
    if isinstance(item, str):
        for line in item.splitlines():
            if line.startswith("data:"):
                return line[5:].strip()
        return item
    return json.dumps(item, ensure_ascii=False)


def sse_response(
    stream_factory: Callable[[], AsyncIterator[str]],
) -> EventSourceResponse:
    return EventSourceResponse(stream_factory(), headers=_SSE_HEADERS)
