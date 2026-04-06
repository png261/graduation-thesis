from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sse_starlette import EventSourceResponse

from app.shared.auth import dependencies as auth_deps
from app.shared.contracts.project_execution import ProjectExecutionRequest
from app.shared.http.sse import normalize_sse_item, sse_json, sse_response
from app.shared.workflow.errors import JobsError

from .runtime import identity_project_persistence, workflow_service

router = APIRouter()


class EnqueueJobBody(BaseModel):
    kind: str
    selected_modules: list[str] = Field(default_factory=list)
    intent: str | None = None
    review_session_id: str | None = None
    review_target: str | None = None
    scope_mode: str | None = None
    confirmation: dict[str, Any] | None = None
    options: dict[str, Any] = Field(default_factory=dict)


class RerunJobBody(BaseModel):
    options: dict[str, Any] = Field(default_factory=dict)


def _raise_jobs_error(exc: JobsError) -> None:
    raise HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": exc.message})


@router.post("/api/projects/{project_id}/jobs")
async def enqueue_job(
    body: EnqueueJobBody,
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict[str, Any]:
    payload = ProjectExecutionRequest.from_payload(
        {
            "selected_modules": body.selected_modules,
            "intent": body.intent,
            "review_session_id": body.review_session_id,
            "review_target": body.review_target,
            "scope_mode": body.scope_mode,
            "confirmation": body.confirmation,
            "options": body.options,
        }
    ).to_job_payload()
    try:
        return await workflow_service.enqueue_project_job(
            project_id=project.id,
            user_id=str(project.user_id or ""),
            kind=body.kind,
            payload=payload,
        )
    except JobsError as exc:
        _raise_jobs_error(exc)


@router.get("/api/projects/{project_id}/jobs")
async def list_jobs(
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
    status: str | None = Query(default=None),
    kind: str | None = Query(default=None),
    limit: int = Query(default=20),
    offset: int = Query(default=0),
) -> dict[str, Any]:
    return await workflow_service.list_jobs(
        project_id=project.id,
        user_id=str(project.user_id or ""),
        status=status,
        kind=kind,
        limit=limit,
        offset=offset,
    )


@router.get("/api/projects/{project_id}/jobs/{job_id}")
async def get_job(
    job_id: str,
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict[str, Any]:
    try:
        return await workflow_service.get_job_by_id(project.id, str(project.user_id or ""), job_id)
    except JobsError as exc:
        _raise_jobs_error(exc)


@router.get("/api/projects/{project_id}/jobs/{job_id}/events/stream")
async def stream_job_events(
    job_id: str,
    request: Request,
    from_seq: int = Query(default=0),
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> EventSourceResponse:
    async def event_stream() -> AsyncIterator[str]:
        try:
            async for payload in workflow_service.stream_job_events(
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


@router.post("/api/projects/{project_id}/jobs/{job_id}/cancel")
async def cancel_job(
    job_id: str,
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict[str, Any]:
    try:
        return await workflow_service.request_cancel(
            project_id=project.id,
            user_id=str(project.user_id or ""),
            job_id=job_id,
        )
    except JobsError as exc:
        _raise_jobs_error(exc)


@router.post("/api/projects/{project_id}/jobs/{job_id}/rerun")
async def rerun_job(
    job_id: str,
    body: RerunJobBody | None = None,
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict[str, Any]:
    try:
        return await workflow_service.rerun_job(
            project_id=project.id,
            user_id=str(project.user_id or ""),
            source_job_id=job_id,
            options_override=body.options if body is not None else None,
        )
    except JobsError as exc:
        _raise_jobs_error(exc)
