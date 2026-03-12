"""Project job queue endpoints."""
from __future__ import annotations

from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sse_starlette import EventSourceResponse

from app.core.sse import normalize_sse_item, sse_json, sse_response
from app.models import Project
from app.routers import auth_dependencies as auth_deps
from app.services.jobs.errors import JobsError
from app.services.jobs import service as jobs_service

router = APIRouter()


class EnqueueJobBody(BaseModel):
    kind: str
    selected_modules: list[str] = Field(default_factory=list)
    intent: str | None = None
    options: dict[str, Any] = Field(default_factory=dict)


def _raise_jobs_error(exc: JobsError) -> None:
    raise HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": exc.message})


@router.post("/{project_id}/jobs")
async def enqueue_job(
    body: EnqueueJobBody,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict[str, Any]:
    try:
        return await jobs_service.enqueue_project_job(
            project=project,
            kind=body.kind,
            payload={
                "selected_modules": body.selected_modules,
                "intent": body.intent,
                "options": body.options,
            },
        )
    except JobsError as exc:
        _raise_jobs_error(exc)


@router.get("/{project_id}/jobs")
async def list_jobs(
    project: Project = Depends(auth_deps.get_owned_project_or_404),
    status: str | None = Query(default=None),
    kind: str | None = Query(default=None),
    limit: int = Query(default=20),
    offset: int = Query(default=0),
) -> dict[str, Any]:
    return await jobs_service.list_jobs(
        project_id=project.id,
        user_id=str(project.user_id or ""),
        status=status,
        kind=kind,
        limit=limit,
        offset=offset,
    )


@router.get("/{project_id}/jobs/{job_id}")
async def get_job(
    job_id: str,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict[str, Any]:
    try:
        return await jobs_service.get_job_by_id(project.id, str(project.user_id or ""), job_id)
    except JobsError as exc:
        _raise_jobs_error(exc)


@router.get("/{project_id}/jobs/{job_id}/events/stream")
async def stream_job_events(
    job_id: str,
    request: Request,
    from_seq: int = Query(default=0),
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> EventSourceResponse:
    async def event_stream() -> AsyncIterator[str]:
        try:
            async for payload in jobs_service.stream_job_events(
                project_id=project.id,
                user_id=str(project.user_id or ""),
                job_id=job_id,
                request=request,
                from_seq=from_seq,
            ):
                yield normalize_sse_item(payload)
                if await request.is_disconnected():
                    break
        except JobsError as exc:
            yield sse_json({"type": "error", "code": exc.code, "message": exc.message})

    return sse_response(event_stream)


@router.post("/{project_id}/jobs/{job_id}/cancel")
async def cancel_job(
    job_id: str,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict[str, Any]:
    try:
        return await jobs_service.request_cancel(
            project_id=project.id,
            user_id=str(project.user_id or ""),
            job_id=job_id,
        )
    except JobsError as exc:
        _raise_jobs_error(exc)


@router.post("/{project_id}/jobs/{job_id}/rerun")
async def rerun_job(
    job_id: str,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict[str, Any]:
    try:
        return await jobs_service.rerun_job(project=project, source_job_id=job_id)
    except JobsError as exc:
        _raise_jobs_error(exc)
