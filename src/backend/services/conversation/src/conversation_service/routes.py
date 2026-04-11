from __future__ import annotations

import logging
import uuid
from typing import AsyncIterator

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sse_starlette import EventSourceResponse

from app.shared.auth import dependencies as auth_deps
from app.shared.contracts.chat import ChatRequest, ChatResponse
from app.shared.http.sse import sse_json, sse_response

from .runtime import conversation_persistence, conversation_service, settings

router = APIRouter()
logger = logging.getLogger(__name__)


async def _ensure_project_thread(project_id: str, thread_id: str) -> None:
    async with conversation_persistence.get_session() as session:
        existing = await session.get(conversation_persistence.Thread, thread_id)
        if existing is None:
            session.add(conversation_persistence.Thread(id=thread_id, project_id=project_id, title=""))
            await session.flush()
            return
        if existing.project_id != project_id:
            auth_deps.raise_http_error(
                409,
                code="thread_project_mismatch",
                message="Thread belongs to another project",
            )


async def _validate_chat_access(
    payload: ChatRequest,
    *,
    user: conversation_persistence.User,
) -> conversation_persistence.Project:
    if not payload.project_id:
        auth_deps.raise_http_error(400, code="project_required", message="Project ID is required")

    async with conversation_persistence.get_session() as session:
        project_result = await session.execute(
            select(conversation_persistence.Project).where(
                conversation_persistence.Project.id == payload.project_id,
                conversation_persistence.Project.user_id == user.id,
            )
        )
        project = project_result.scalar_one_or_none()
        if project is None:
            auth_deps.raise_http_error(404, code="project_not_found", message="Project not found")

        if payload.thread_id:
            thread_result = await session.execute(
                select(conversation_persistence.Thread).where(conversation_persistence.Thread.id == payload.thread_id)
            )
            thread = thread_result.scalar_one_or_none()
            if thread and thread.project_id != payload.project_id:
                auth_deps.raise_http_error(
                    409,
                    code="thread_project_mismatch",
                    message="Thread belongs to another project",
                )
    return project


async def _stream_inline_chat_events(
    payload: ChatRequest,
    *,
    resolved_thread_id: str,
    request: Request,
) -> AsyncIterator[str]:
    inline_payload = payload.model_copy(update={"thread_id": resolved_thread_id})
    async for event in conversation_service.stream_response_events(
        inline_payload,
        settings,
        cancel_checker=request.is_disconnected,
    ):
        yield sse_json(event)
        if await request.is_disconnected():
            break


async def _chat_event_stream(
    *,
    payload: ChatRequest,
    request: Request,
    resolved_thread_id: str,
) -> AsyncIterator[str]:
    try:
        async for event in _stream_inline_chat_events(
            payload,
            resolved_thread_id=resolved_thread_id,
            request=request,
        ):
            yield event
    except Exception:
        logger.exception("streaming error")
        yield sse_json({"type": "error", "message": "stream_failed"})
    finally:
        yield sse_json({"type": "done"})


@router.post("/api/chat", response_model=ChatResponse)
async def chat(
    payload: ChatRequest,
    user: conversation_persistence.User = Depends(auth_deps.require_current_user),
) -> ChatResponse:
    await _validate_chat_access(payload, user=user)
    response_text = await conversation_service.generate_response(payload, settings)
    return ChatResponse(text=response_text, thread_id=payload.thread_id)


@router.post("/api/chat/stream")
async def chat_stream(
    payload: ChatRequest,
    request: Request,
    user: conversation_persistence.User = Depends(auth_deps.require_current_user),
) -> EventSourceResponse:
    project = await _validate_chat_access(payload, user=user)
    conversation_service.ensure_settings(settings)
    conversation_service.ensure_payload(payload)
    resolved_thread_id = payload.thread_id or str(uuid.uuid4())
    await _ensure_project_thread(project.id, resolved_thread_id)

    return sse_response(
        lambda: _chat_event_stream(
            payload=payload,
            request=request,
            resolved_thread_id=resolved_thread_id,
        )
    )
