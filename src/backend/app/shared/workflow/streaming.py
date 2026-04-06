from __future__ import annotations

from typing import Any, AsyncIterator

from fastapi import Request
from sse_starlette import EventSourceResponse

from app.shared.http.sse import normalize_sse_item, sse_json, sse_response
from app.shared.identity import persistence as identity_project_persistence
from app.shared.workflow.errors import JobsError


def stream_enqueued_project_job(
    *,
    workflow_service,
    project: identity_project_persistence.Project,
    kind: str,
    payload: dict[str, Any],
    request: Request,
    fallback_error_code: str,
) -> EventSourceResponse:
    async def event_stream() -> AsyncIterator[str]:
        try:
            job = await workflow_service.enqueue_project_job(
                project_id=project.id,
                user_id=str(project.user_id or ""),
                kind=kind,
                payload=payload,
            )
            async for event in workflow_service.stream_job_events(
                project_id=project.id,
                user_id=str(project.user_id or ""),
                job_id=str(job["id"]),
                request=request,
                from_seq=0,
            ):
                if await request.is_disconnected():
                    break
                yield normalize_sse_item(event)
        except JobsError as exc:
            yield sse_json({"type": "error", "code": exc.code, "message": exc.message})
        except Exception:
            yield sse_json({"type": "error", "code": fallback_error_code, "message": fallback_error_code})

    return sse_response(event_stream)


__all__ = ["stream_enqueued_project_job"]
