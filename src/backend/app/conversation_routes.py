from __future__ import annotations

import json
import logging
import uuid
from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sse_starlette import EventSourceResponse

from app.core.config import get_settings
from app.core.sse import normalize_sse_item, sse_json, sse_response
from app.routers import auth_dependencies as auth_deps
from app.schemas.chat import ChatMessage, ChatRequest, ChatResponse
from app.services.conversation import api as conversation_service
from app.services.conversation import persistence as conversation_persistence
from app.services.jobs.errors import JobsError
from app.services.workflow import api as workflow_service

router = APIRouter()
settings = get_settings()
logger = logging.getLogger(__name__)


def _is_chat_queue_unavailable(exc: JobsError | None) -> bool:
    if exc is None:
        return False
    return exc.status_code == 503 or exc.code in {"job_queue_unavailable", "chat_queue_unavailable"}


def _decode_stream_event(raw: str) -> dict[str, Any] | None:
    normalized = normalize_sse_item(raw)
    try:
        parsed = json.loads(normalized)
    except json.JSONDecodeError:
        return None
    if isinstance(parsed, dict):
        return parsed
    return None


def _chat_message_payload(message: ChatMessage) -> dict[str, Any]:
    payload: dict[str, Any] = {"role": message.role.value, "content": message.content}
    if not message.attachments:
        return payload
    payload["attachments"] = [
        {
            "name": attachment.name,
            "content": attachment.content,
            "content_type": attachment.content_type,
            "size_bytes": attachment.size_bytes,
        }
        for attachment in message.attachments
    ]
    return payload


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


async def _chat_job_event_stream(
    *,
    project: conversation_persistence.Project,
    payload: ChatRequest,
    request: Request,
    resolved_thread_id: str,
    enqueued_job_id: str | None,
    enqueue_error: JobsError | None,
) -> AsyncIterator[str]:
    try:
        if _is_chat_queue_unavailable(enqueue_error):
            async for event in _stream_inline_chat_events(
                payload,
                resolved_thread_id=resolved_thread_id,
                request=request,
            ):
                yield event
            return
        if enqueue_error is not None:
            raise enqueue_error
        if enqueued_job_id is None:
            raise RuntimeError("chat job enqueue failed")
        yield sse_json({"type": "chat.job", "jobId": enqueued_job_id, "threadId": resolved_thread_id})
        async for raw in workflow_service.stream_job_events(
            project_id=project.id,
            user_id=str(project.user_id or ""),
            job_id=enqueued_job_id,
            request=request,
        ):
            event = _decode_stream_event(raw)
            if not event:
                continue
            event_type = str(event.get("type") or "")
            if event_type in {"job.queued", "job.running", "job.cancel_requested", "job.canceled"}:
                continue
            if event_type == "job.terminal":
                break
            yield sse_json(event)
            if await request.is_disconnected():
                break
    except JobsError as exc:
        yield sse_json({"type": "error", "code": exc.code, "message": exc.message})
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
    enqueued_job_id: str | None = None
    enqueue_error: JobsError | None = None
    try:
        job = await workflow_service.enqueue_project_job(
            project_id=project.id,
            user_id=str(project.user_id or ""),
            kind="chat",
            payload={
                "project_id": project.id,
                "thread_id": resolved_thread_id,
                "messages": [_chat_message_payload(msg) for msg in payload.messages],
            },
        )
        enqueued_job_id = str(job["id"])
    except JobsError as exc:
        enqueue_error = exc
    except Exception as exc:
        logger.exception("failed to enqueue chat job", exc_info=exc)
        enqueue_error = JobsError(
            "Chat queue is unavailable",
            code="chat_queue_unavailable",
            status_code=503,
        )

    return sse_response(
        _chat_job_event_stream(
            project=project,
            payload=payload,
            request=request,
            resolved_thread_id=resolved_thread_id,
            enqueued_job_id=enqueued_job_id,
            enqueue_error=enqueue_error,
        )
    )
