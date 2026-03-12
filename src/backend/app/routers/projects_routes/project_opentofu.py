"""OpenTofu deploy endpoints for projects."""

from __future__ import annotations
from typing import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sse_starlette import EventSourceResponse

from app.core.config import get_settings
from app.core.sse import normalize_sse_item, sse_json, sse_response
from app.models import Project
from app.routers import auth_dependencies as auth_deps
from app.services.jobs import service as jobs_service
from app.services.jobs.errors import JobsError
from app.services.opentofu import deploy as opentofu_deploy
from app.services.opentofu.runtime.shared import discover_modules_from_project_dir
from app.services.project import files as project_files

router = APIRouter()


class OpenTofuPreviewBody(BaseModel):
    intent: str | None = None


class OpenTofuApplyBody(BaseModel):
    selected_modules: list[str] = []
    intent: str | None = None
    override_policy: bool = False


def _raise_runtime_error(data: dict) -> None:
    code = str(data.get("code") or "")
    message = str(data.get("message") or "Operation failed")
    detail = {"code": code or "runtime_error", "message": message}
    if code == "invalid_module" or code == "invalid_graph_type":
        raise HTTPException(status_code=400, detail=detail)
    if code == "missing_api_key":
        raise HTTPException(status_code=400, detail=detail)
    if code == "tool_unavailable":
        raise HTTPException(status_code=503, detail=detail)
    raise HTTPException(status_code=400, detail=detail)


def _is_fatal_runtime_error(data: dict) -> bool:
    code = str(data.get("code") or "")
    return code in {"invalid_module", "invalid_graph_type", "missing_api_key", "tool_unavailable"}


@router.get("/{project_id}/opentofu/status")
async def opentofu_status(project: Project = Depends(auth_deps.get_owned_project_or_404)) -> dict:
    status = await opentofu_deploy.get_opentofu_status(project.id)
    if not status["project_found"]:
        raise HTTPException(status_code=404, detail="Project not found")
    return status


@router.post("/{project_id}/opentofu/deploy/preview")
async def opentofu_preview(
    body: OpenTofuPreviewBody,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    data = await opentofu_deploy.preview_deploy(
        project_id=project.id,
        settings=get_settings(),
        intent=body.intent,
    )
    if not data.get("project_found", True):
        raise HTTPException(status_code=404, detail="Project not found")
    return data


@router.post("/{project_id}/opentofu/deploy/apply/stream")
async def opentofu_apply_stream(
    body: OpenTofuApplyBody,
    request: Request,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> EventSourceResponse:
    async def event_stream() -> AsyncIterator[str]:
        try:
            job = await jobs_service.enqueue_project_job(
                project=project,
                kind="apply",
                payload={
                    "selected_modules": body.selected_modules,
                    "intent": body.intent,
                    "options": {"override_policy": body.override_policy},
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
            yield sse_json(
                {"type": "error", "code": "opentofu_apply_failed", "message": "opentofu_apply_failed"}
            )

    return sse_response(event_stream)


@router.get("/{project_id}/runs/history")
async def runs_history(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    history = await jobs_service.list_jobs(
        project_id=project.id,
        user_id=str(project.user_id or ""),
        status=None,
        kind=None,
        limit=limit,
        offset=offset,
    )
    return {
        "total": history["total"],
        "items": history["items"],
    }


@router.get("/{project_id}/drift/status")
async def drift_status(project: Project = Depends(auth_deps.get_owned_project_or_404)) -> dict:
    modules = discover_modules_from_project_dir(project.id)
    project_root = project_files.ensure_project_dir(project.id)
    state_root = project_root / ".opentofu-runtime" / "state"
    modules_without_state = [module for module in modules if not (state_root / f"{module}.tfstate").is_file()]

    latest_plan = await jobs_service.list_jobs(
        project_id=project.id,
        user_id=str(project.user_id or ""),
        status=None,
        kind="plan",
        limit=1,
        offset=0,
    )
    latest_apply = await jobs_service.list_jobs(
        project_id=project.id,
        user_id=str(project.user_id or ""),
        status=None,
        kind="apply",
        limit=1,
        offset=0,
    )

    latest_plan_job = latest_plan["items"][0] if latest_plan["items"] else None
    latest_apply_job = latest_apply["items"][0] if latest_apply["items"] else None

    if not modules:
        status = "no_modules"
    elif modules_without_state:
        status = "state_missing"
    elif not latest_plan_job:
        status = "plan_missing"
    elif latest_apply_job and str(latest_plan_job.get("created_at", "")) < str(latest_apply_job.get("created_at", "")):
        status = "plan_outdated"
    else:
        status = "in_sync"

    return {
        "status": status,
        "module_count": len(modules),
        "modules_without_state": modules_without_state,
        "last_plan_job": latest_plan_job,
        "last_apply_job": latest_apply_job,
    }


@router.post("/{project_id}/opentofu/deploy/plan/stream")
async def opentofu_plan_stream(
    body: OpenTofuApplyBody,
    request: Request,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> EventSourceResponse:
    async def event_stream() -> AsyncIterator[str]:
        try:
            job = await jobs_service.enqueue_project_job(
                project=project,
                kind="plan",
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
            yield sse_json({"type": "error", "code": "opentofu_plan_failed", "message": "opentofu_plan_failed"})

    return sse_response(event_stream)


@router.get("/{project_id}/opentofu/costs")
async def opentofu_costs(
    module: str = Query(default="all"),
    refresh: bool = Query(default=False),
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    data = await opentofu_deploy.get_costs(
        project_id=project.id,
        settings=get_settings(),
        module_scope=module,
        refresh=refresh,
    )
    if not data.get("project_found", True):
        raise HTTPException(status_code=404, detail="Project not found")
    if data.get("status") == "error" and _is_fatal_runtime_error(data):
        _raise_runtime_error(data)
    return data


@router.get("/{project_id}/opentofu/graph")
async def opentofu_graph(
    module: str = Query(default="all"),
    type: str = Query(default="plan"),
    refresh: bool = Query(default=False),
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    data = await opentofu_deploy.get_graph(
        project_id=project.id,
        settings=get_settings(),
        module_scope=module,
        graph_type=type,
        refresh=refresh,
    )
    if not data.get("project_found", True):
        raise HTTPException(status_code=404, detail="Project not found")
    if data.get("status") == "error" and _is_fatal_runtime_error(data):
        _raise_runtime_error(data)
    return data
