"""Project incident memory and metrics endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.models import Project
from app.routers import auth_dependencies as auth_deps
from app.routers.http_errors import raise_http_error
from app.services.incident import service as incident_service

router = APIRouter()


@router.get("/{project_id}/incidents")
async def list_incidents(
    limit: int = Query(default=50),
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    items = await incident_service.list_summaries(project_id=project.id, limit=limit)
    return {"incidents": items}


@router.get("/{project_id}/incidents/{incident_id}")
async def get_incident(
    incident_id: str,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    try:
        item = await incident_service.get_summary(project_id=project.id, incident_id=incident_id)
    except ValueError as exc:
        raise_http_error(404, code=str(exc), message=str(exc))
    return item


class ResolutionQualityBody(BaseModel):
    quality: str


@router.post("/{project_id}/incidents/{incident_id}/resolution-quality")
async def mark_incident_resolution_quality(
    incident_id: str,
    body: ResolutionQualityBody,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    try:
        return await incident_service.mark_resolution_quality(
            project_id=project.id,
            incident_id=incident_id,
            quality=body.quality,
        )
    except ValueError as exc:
        status = 404 if str(exc) == "incident_not_found" else 400
        raise_http_error(status, code=str(exc), message=str(exc))


@router.get("/{project_id}/incidents/metrics/summary")
async def incident_metrics(
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    metrics = await incident_service.get_metrics(project_id=project.id)
    return {"metrics": metrics}
