"""Ansible runtime endpoints for projects."""
from __future__ import annotations

from typing import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sse_starlette import EventSourceResponse

from app.core.config import get_settings
from app.core.sse import normalize_sse_item, sse_json, sse_response
from app.models import Project
from app.routers import auth_dependencies as auth_deps
from app.services.jobs.errors import JobsError
from app.services.jobs import service as jobs_service
from app.services.ansible import deploy as ansible_deploy

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
    async def event_stream() -> AsyncIterator[str]:
        try:
            job = await jobs_service.enqueue_project_job(
                project=project,
                kind="ansible",
                payload={
                    "selected_modules": body.selected_modules,
                    "intent": body.intent,
                    "options": {},
                },
            )
            async for payload in jobs_service.stream_job_events(
                project_id=project.id,
                user_id=str(project.user_id or ""),
                job_id=str(job["id"]),
                request=request,
                from_seq=0,
            ):
                if await request.is_disconnected():
                    break
                yield normalize_sse_item(payload)
        except JobsError as exc:
            yield sse_json({"type": "error", "code": exc.code, "message": exc.message})
        except Exception:
            yield sse_json({"type": "error", "code": "config_failed", "message": "ansible_run_failed"})

    return sse_response(event_stream)
