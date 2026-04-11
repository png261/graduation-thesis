"""Shared SSE helpers for project job endpoints."""

from __future__ import annotations

from typing import AsyncIterator, Callable

from fastapi import Request
from sse_starlette import EventSourceResponse

from app.core.sse import sse_json, sse_response


def stream_project_events(
    *,
    event_stream_factory: Callable[[], AsyncIterator[dict]],
    request: Request,
    fallback_error_code: str,
) -> EventSourceResponse:
    async def event_stream() -> AsyncIterator[str]:
        try:
            async for event in event_stream_factory():
                if await request.is_disconnected():
                    break
                yield sse_json(event)
        except Exception:
            yield sse_json({"type": "error", "code": fallback_error_code, "message": fallback_error_code})

    return sse_response(event_stream)
