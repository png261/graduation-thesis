from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sse_starlette import EventSourceResponse

from app.shared.auth import dependencies as auth_deps
from app.shared.contracts.project_execution import ProjectExecutionRequest
from app.shared.http.errors import raise_http_error

from .runtime import (
    configuration_incident_service,
    identity_project_persistence,
    settings,
    stream_enqueued_project_job,
    workflow_service,
)

router = APIRouter()


class AnsibleRunBody(BaseModel):
    selected_modules: list[str] = []
    intent: str | None = None


class ResolutionQualityBody(BaseModel):
    quality: str


@router.get("/api/projects/{project_id}/ansible/status")
async def ansible_status(
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    status = await configuration_incident_service.get_ansible_status(project.id, settings)
    if not status["project_found"]:
        raise HTTPException(status_code=404, detail="Project not found")
    return status


@router.post("/api/projects/{project_id}/ansible/run/stream")
async def ansible_run_stream(
    body: AnsibleRunBody,
    request: Request,
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> EventSourceResponse:
    payload = ProjectExecutionRequest(
        selected_modules=tuple(body.selected_modules),
        intent=body.intent,
        options={},
    ).to_job_payload()
    return stream_enqueued_project_job(
        workflow_service=workflow_service,
        project=project,
        kind="ansible",
        payload=payload,
        request=request,
        fallback_error_code="config_failed",
    )


@router.get("/api/projects/{project_id}/incidents")
async def list_incidents(
    limit: int = Query(default=50),
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    items = await configuration_incident_service.list_incident_summaries(project_id=project.id, limit=limit)
    return {"incidents": items}


@router.get("/api/projects/{project_id}/incidents/{incident_id}")
async def get_incident(
    incident_id: str,
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    try:
        item = await configuration_incident_service.get_incident_summary(
            project_id=project.id,
            incident_id=incident_id,
        )
    except ValueError as exc:
        raise_http_error(404, code=str(exc), message=str(exc))
    return item


@router.post("/api/projects/{project_id}/incidents/{incident_id}/resolution-quality")
async def mark_incident_resolution_quality(
    incident_id: str,
    body: ResolutionQualityBody,
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    try:
        return await configuration_incident_service.mark_incident_resolution_quality(
            project_id=project.id,
            incident_id=incident_id,
            quality=body.quality,
        )
    except ValueError as exc:
        status = 404 if str(exc) == "incident_not_found" else 400
        raise_http_error(status, code=str(exc), message=str(exc))


@router.get("/api/projects/{project_id}/incidents/metrics/summary")
async def incident_metrics(
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    metrics = await configuration_incident_service.get_incident_metrics(project_id=project.id)
    return {"metrics": metrics}
