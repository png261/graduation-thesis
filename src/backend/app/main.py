from __future__ import annotations

import asyncio
import logging
import uuid
from contextlib import asynccontextmanager
from http import HTTPStatus
from typing import Any, AsyncIterator

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sse_starlette import EventSourceResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import db
from app.core import cache as runtime_cache
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.core.sse import sse_json, sse_response
from app.models import Project, Thread, User
from app.routers import auth_dependencies as auth_deps
from app.routers import github as github_router
from app.routers import projects as projects_router
from app.routers import state as state_router
from app.schemas.chat import ChatRequest, ChatResponse
from app.services.chat import service as chat_service
from app.services.model.factory import close_agent_store
from app.services.state_backends import service as state_backends_service

settings = get_settings()
configure_logging(settings.log_level)
logger = logging.getLogger(__name__)

_STATUS_ERROR_CODES: dict[int, str] = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    413: "payload_too_large",
    415: "unsupported_media_type",
    422: "validation_error",
    429: "too_many_requests",
    500: "internal_error",
    503: "service_unavailable",
}


def _default_error_code(status_code: int) -> str:
    if status_code in _STATUS_ERROR_CODES:
        return _STATUS_ERROR_CODES[status_code]
    if status_code >= 500:
        return "server_error"
    if status_code >= 400:
        return "request_error"
    return "error"


def _default_error_message(status_code: int) -> str:
    try:
        return HTTPStatus(status_code).phrase
    except ValueError:
        return "Request failed"


def _extract_http_error_payload(exc: StarletteHTTPException) -> tuple[str, str, dict[str, Any] | None]:
    default_code = _default_error_code(exc.status_code)
    default_message = _default_error_message(exc.status_code)
    detail = exc.detail
    if isinstance(detail, dict):
        raw_code = detail.get("code")
        raw_message = detail.get("message")
        code = str(raw_code).strip() if raw_code is not None else default_code
        message = str(raw_message).strip() if raw_message is not None else default_message
        raw_details = detail.get("details")
        if isinstance(raw_details, dict):
            details = raw_details
        else:
            extras = {k: v for k, v in detail.items() if k not in {"code", "message", "details"}}
            details = extras or None
        return code or default_code, message or default_message, details
    if isinstance(detail, str):
        message = detail.strip() or default_message
        return default_code, message, None
    if detail is None:
        return default_code, default_message, None
    return default_code, str(detail), None


def _error_response(
    *,
    status_code: int,
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
) -> JSONResponse:
    payload: dict[str, Any] = {"code": code, "message": message}
    if details:
        payload["details"] = details
    return JSONResponse(status_code=status_code, content=payload)


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def handle_http_exception(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code, message, details = _extract_http_error_payload(exc)
        return _error_response(status_code=exc.status_code, code=code, message=message, details=details)

    @app.exception_handler(RequestValidationError)
    async def handle_request_validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        return _error_response(
            status_code=422,
            code="validation_error",
            message="Validation failed",
            details={"errors": exc.errors()},
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_exception(_request: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled server error", exc_info=exc)
        return _error_response(status_code=500, code="internal_error", message="Internal server error")


async def _run_periodic_task(
    *,
    interval_seconds: int,
    action,
    task_name: str,
) -> None:
    while True:
        try:
            await action()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("background task failed: %s", task_name)
        await asyncio.sleep(max(1, interval_seconds))


async def _run_state_sync_tick() -> None:
    await state_backends_service.sync_due_backends(settings=settings)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_db(settings.database_url)
    logger.info("Database initialised")
    background_tasks = [
        asyncio.create_task(
            _run_periodic_task(
                interval_seconds=max(300, settings.state_sync_scan_interval_minutes * 60),
                action=_run_state_sync_tick,
                task_name="state-sync",
            )
        ),
    ]
    yield
    for task in background_tasks:
        task.cancel()
    if background_tasks:
        await asyncio.gather(*background_tasks, return_exceptions=True)
    await runtime_cache.close_redis()
    await close_agent_store()
    await db.close_db()
    logger.info("Database closed")


app = FastAPI(title="Deep Agents API", version="0.1.0", lifespan=lifespan)
app.include_router(projects_router.router)
app.include_router(github_router.router)
app.include_router(state_router.router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list(),
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
register_exception_handlers(app)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.post("/api/chat", response_model=ChatResponse)
async def chat(
    payload: ChatRequest,
    user: User = Depends(auth_deps.require_current_user),
) -> ChatResponse:
    await _validate_chat_access(payload, user=user)
    response_text = await chat_service.generate_response(payload, settings)
    return ChatResponse(text=response_text, thread_id=payload.thread_id)


@app.post("/api/chat/stream")
async def chat_stream(
    payload: ChatRequest,
    request: Request,
    user: User = Depends(auth_deps.require_current_user),
) -> EventSourceResponse:
    project = await _validate_chat_access(payload, user=user)
    chat_service.ensure_settings(settings)
    chat_service.ensure_payload(payload)
    resolved_thread_id = payload.thread_id or str(uuid.uuid4())
    await _ensure_project_thread(project.id, resolved_thread_id)

    async def _stream_inline_chat_events() -> AsyncIterator[str]:
        inline_payload = payload.model_copy(update={"thread_id": resolved_thread_id})
        async for event in chat_service.stream_response_events(
            inline_payload,
            settings,
            cancel_checker=request.is_disconnected,
        ):
            yield sse_json(event)
            if await request.is_disconnected():
                break

    async def event_stream():
        try:
            async for event in _stream_inline_chat_events():
                yield event
        except Exception:
            logger.exception("streaming error")
            yield sse_json({"type": "error", "message": "stream_failed"})
        finally:
            yield sse_json({"type": "done"})

    return sse_response(event_stream)


async def _ensure_project_thread(project_id: str, thread_id: str) -> None:
    async with db.get_session() as session:
        existing = await session.get(Thread, thread_id)
        if existing is None:
            session.add(Thread(id=thread_id, project_id=project_id, title=""))
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
    user: User,
) -> Project:
    if not payload.project_id:
        auth_deps.raise_http_error(400, code="project_required", message="Project ID is required")

    async with db.get_session() as session:
        project_result = await session.execute(
            select(Project).where(Project.id == payload.project_id, Project.user_id == user.id)
        )
        project = project_result.scalar_one_or_none()
        if project is None:
            auth_deps.raise_http_error(404, code="project_not_found", message="Project not found")

        if payload.thread_id:
            thread_result = await session.execute(select(Thread).where(Thread.id == payload.thread_id))
            thread = thread_result.scalar_one_or_none()
            if thread and thread.project_id != payload.project_id:
                auth_deps.raise_http_error(
                    409,
                    code="thread_project_mismatch",
                    message="Thread belongs to another project",
                )
    return project
