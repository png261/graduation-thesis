from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable

from app.core.config import Settings
from app.shared.contracts.chat import ChatRequest

from .backend import chat_service

CancelChecker = Callable[[], Awaitable[bool]]


def ensure_settings(settings: Settings) -> None:
    chat_service.ensure_settings(settings)


def ensure_payload(payload: ChatRequest) -> None:
    chat_service.ensure_payload(payload)


async def generate_response(payload: ChatRequest, settings: Settings) -> str:
    return await chat_service.generate_response(payload, settings)


async def stream_response_events(
    payload: ChatRequest,
    settings: Settings,
    *,
    cancel_checker: CancelChecker,
) -> AsyncIterator[dict]:
    async for event in chat_service.stream_response_events(
        payload,
        settings,
        cancel_checker=cancel_checker,
    ):
        yield event
