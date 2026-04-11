"""Ansible runtime endpoints for projects."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sse_starlette import EventSourceResponse

from app.core.config import get_settings
from app.models import Project
from app.routers import auth_dependencies as auth_deps
from app.routers.projects_routes.streaming import stream_project_events
from app.services.ansible import deploy as ansible_deploy
from app.services.project_execution.contracts import ProjectExecutionRequest

router = APIRouter()


class AnsibleRunBody(BaseModel):
    selected_modules: list[str] = []
    intent: str | None = None


@router.get("/{project_id}/ansible/status")
async def ansible_status(project: Project = Depends(auth_deps.get_owned_project_or_404)) -> dict:
    status = await ansible_deploy.get_ansible_status(project.id, get_settings())
    if not status["project_found"]:
        raise HTTPException(status_code=404, detail="Project not found")
    return status


@router.post("/{project_id}/ansible/run/stream")
async def ansible_run_stream(
    body: AnsibleRunBody,
    request: Request,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> EventSourceResponse:
    request_body = ProjectExecutionRequest(
        selected_modules=tuple(body.selected_modules),
        intent=body.intent,
        options={},
    )
    settings = get_settings()
    return stream_project_events(
        event_stream_factory=lambda: ansible_deploy.run_playbook_stream(
            project_id=project.id,
            settings=settings,
            selected_modules=request_body.selected_modules_list(),
            intent=request_body.intent,
            cancel_checker=request.is_disconnected,
        ),
        request=request,
        fallback_error_code="config_failed",
    )
