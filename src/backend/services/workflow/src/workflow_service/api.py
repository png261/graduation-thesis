from __future__ import annotations

from typing import Any, AsyncIterator

from fastapi import Request

from .backend import jobs_service


async def enqueue_project_job(
    *,
    project_id: str,
    user_id: str,
    kind: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    return await jobs_service.enqueue_project_job(
        project_id=project_id,
        user_id=user_id,
        kind=kind,
        payload=payload,
    )


async def list_jobs(
    *,
    project_id: str,
    user_id: str,
    status: str | None,
    kind: str | None,
    limit: int,
    offset: int,
) -> dict[str, Any]:
    return await jobs_service.list_jobs(
        project_id=project_id,
        user_id=user_id,
        status=status,
        kind=kind,
        limit=limit,
        offset=offset,
    )


async def latest_successful_job_result(
    *,
    project_id: str,
    user_id: str,
    kind: str,
) -> dict[str, Any] | None:
    history = await list_jobs(
        project_id=project_id,
        user_id=user_id,
        status="succeeded",
        kind=kind,
        limit=1,
        offset=0,
    )
    latest = history["items"][0] if history["items"] else None
    result = latest.get("result") if isinstance(latest, dict) else None
    return result if isinstance(result, dict) else None


async def get_job_by_id(project_id: str, user_id: str, job_id: str) -> dict[str, Any]:
    return await jobs_service.get_job_by_id(project_id, user_id, job_id)


async def stream_job_events(
    *,
    project_id: str,
    user_id: str,
    job_id: str,
    request: Request,
    from_seq: int = 0,
) -> AsyncIterator[str]:
    async for payload in jobs_service.stream_job_events(
        project_id=project_id,
        user_id=user_id,
        job_id=job_id,
        request=request,
        from_seq=from_seq,
    ):
        yield payload


async def request_cancel(
    *,
    project_id: str,
    user_id: str,
    job_id: str,
) -> dict[str, Any]:
    return await jobs_service.request_cancel(
        project_id=project_id,
        user_id=user_id,
        job_id=job_id,
    )


async def rerun_job(
    *,
    project_id: str,
    user_id: str,
    source_job_id: str,
    options_override: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return await jobs_service.rerun_job(
        project_id=project_id,
        user_id=user_id,
        source_job_id=source_job_id,
        options_override=options_override,
    )
