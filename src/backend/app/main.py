from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.core.config import get_settings
from app.core.logging import configure_logging
from app import db
from app.routers import github as github_router
from app.routers import auth as auth_router
from app.routers import auth_dependencies as auth_deps
from app.routers import projects as projects_router
from app.models import Project, Thread, User
from app.schemas.chat import ChatRequest, ChatResponse
from app.services.chat import service as chat_service
from sqlalchemy import select

settings = get_settings()
configure_logging(settings.log_level)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_db(settings.database_url)
    logger.info("Database initialised")
    yield
    await db.close_db()
    logger.info("Database closed")


app = FastAPI(title="Deep Agents API", version="0.1.0", lifespan=lifespan)
app.include_router(projects_router.router)
app.include_router(github_router.router)
app.include_router(auth_router.router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.post("/api/chat", response_model=ChatResponse)
async def chat(
    payload: ChatRequest,
    user: User | None = Depends(auth_deps.get_current_user_optional),
) -> ChatResponse:
    await _validate_chat_access(payload, user=user)
    if user is None:
        response_text = await chat_service.generate_basic_response(payload, settings)
    else:
        response_text = await chat_service.generate_response(payload, settings)
    return ChatResponse(text=response_text, thread_id=payload.thread_id)


@app.post("/api/chat/stream")
async def chat_stream(
    payload: ChatRequest,
    request: Request,
    user: User | None = Depends(auth_deps.get_current_user_optional),
) -> StreamingResponse:
    await _validate_chat_access(payload, user=user)
    chat_service.ensure_settings(settings)
    chat_service.ensure_payload(payload)

    async def event_stream():
        try:
            if user is None:
                streamer = chat_service.stream_basic_response(payload, settings, request)
            else:
                streamer = chat_service.stream_response(payload, settings, request)
            async for event in streamer:
                yield f"data: {json.dumps(event)}\n\n"
        except Exception:
            logger.exception("streaming error")
            yield f"data: {json.dumps({'type': 'error', 'message': 'stream_failed'})}\n\n"
        finally:
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }

    return StreamingResponse(event_stream(), media_type="text/event-stream", headers=headers)


async def _validate_chat_access(
    payload: ChatRequest,
    *,
    user: User | None,
) -> None:
    if not payload.project_id:
        return

    if user is None:
        auth_deps.raise_http_error(
            401,
            code="login_required",
            message="Login required",
        )

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
