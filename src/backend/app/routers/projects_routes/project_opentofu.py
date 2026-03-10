"""OpenTofu deploy endpoints for projects."""
from __future__ import annotations

import json
from typing import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.core.config import get_settings
from app.models import Project
from app.routers import auth_dependencies as auth_deps
from app.services.opentofu import deploy as opentofu_deploy

router = APIRouter()


class OpenTofuPreviewBody(BaseModel):
    intent: str | None = None


class OpenTofuApplyBody(BaseModel):
    selected_modules: list[str] = []
    intent: str | None = None


def _sse_response(stream_factory) -> StreamingResponse:
    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(stream_factory(), media_type="text/event-stream", headers=headers)


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
) -> StreamingResponse:
    async def event_stream() -> AsyncIterator[str]:
        try:
            async for event in opentofu_deploy.apply_modules_stream(
                project_id=project.id,
                settings=get_settings(),
                selected_modules=body.selected_modules,
                intent=body.intent,
            ):
                if await request.is_disconnected():
                    break
                yield f"data: {json.dumps(event)}\n\n"
        except Exception:
            yield f"data: {json.dumps({'type': 'error', 'message': 'opentofu_apply_failed'})}\n\n"
        finally:
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return _sse_response(event_stream)


@router.post("/{project_id}/opentofu/deploy/plan/stream")
async def opentofu_plan_stream(
    body: OpenTofuApplyBody,
    request: Request,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> StreamingResponse:
    async def event_stream() -> AsyncIterator[str]:
        try:
            async for event in opentofu_deploy.plan_modules_stream(
                project_id=project.id,
                settings=get_settings(),
                selected_modules=body.selected_modules,
                intent=body.intent,
            ):
                if await request.is_disconnected():
                    break
                yield f"data: {json.dumps(event)}\n\n"
        except Exception:
            yield f"data: {json.dumps({'type': 'error', 'message': 'opentofu_plan_failed'})}\n\n"
        finally:
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return _sse_response(event_stream)


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
