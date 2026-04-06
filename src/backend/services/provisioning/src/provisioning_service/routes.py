from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sse_starlette import EventSourceResponse

from app.shared.auth import dependencies as auth_deps
from app.shared.contracts.project_execution import ExecutionConfirmation, ProjectExecutionRequest

from .runtime import (
    execution_policy,
    identity_project_persistence,
    provisioning_service,
    settings,
    stream_enqueued_project_job,
    workflow_service,
)

router = APIRouter()


class OpenTofuPreviewBody(BaseModel):
    intent: str | None = None


class OpenTofuConfirmationBody(BaseModel):
    project_name: str | None = None
    keyword: str | None = None
    selected_modules: list[str] = Field(default_factory=list)


class OpenTofuApplyBody(BaseModel):
    selected_modules: list[str] = Field(default_factory=list)
    intent: str | None = None
    override_policy: bool = False
    review_session_id: str | None = None
    review_target: str | None = None
    scope_mode: str | None = None
    confirmation: OpenTofuConfirmationBody | None = None
    options: dict[str, Any] = Field(default_factory=dict)


class OpenTofuDestroyBody(BaseModel):
    selected_modules: list[str] = Field(default_factory=list)
    intent: str | None = None
    review_session_id: str | None = None
    review_target: str | None = None
    scope_mode: str | None = None
    confirmation: OpenTofuConfirmationBody | None = None
    options: dict[str, Any] = Field(default_factory=dict)


def _body_options(body: OpenTofuApplyBody | OpenTofuDestroyBody) -> dict[str, Any]:
    options = dict(body.options or {})
    if isinstance(body, OpenTofuApplyBody) and body.override_policy:
        options["override_policy"] = body.override_policy
    return options


def _execution_request_from_body(body: OpenTofuApplyBody | OpenTofuDestroyBody) -> ProjectExecutionRequest:
    return ProjectExecutionRequest(
        selected_modules=tuple(body.selected_modules),
        intent=body.intent,
        review_session_id=body.review_session_id,
        review_target=body.review_target,
        scope_mode=body.scope_mode,
        confirmation=(
            None if body.confirmation is None else ExecutionConfirmation.from_value(body.confirmation.model_dump())
        ),
        options=_body_options(body),
    )


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


async def _latest_successful_plan_result(
    project: identity_project_persistence.Project,
) -> dict[str, Any] | None:
    return await workflow_service.latest_successful_job_result(
        project_id=project.id,
        user_id=str(project.user_id or ""),
        kind="plan",
    )


async def _resolved_review(
    *,
    project: identity_project_persistence.Project,
    request: ProjectExecutionRequest,
) -> dict[str, Any]:
    return provisioning_service.resolve_plan_review(
        project_id=project.id,
        review_result=await _latest_successful_plan_result(project),
        review_session_id=request.review_session_id,
        review_target=request.resolved_review_target(),
        scope_mode=request.effective_scope_mode(),
        selected_modules=request.selected_modules_list(),
    )


def _history_item_with_post_deploy(item: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(item)
    post_deploy_summary = normalized.get("post_deploy_summary")
    result = normalized.get("result")
    if post_deploy_summary is None and isinstance(result, dict):
        post_deploy = result.get("post_deploy")
        if isinstance(post_deploy, dict):
            summary = post_deploy.get("summary") if isinstance(post_deploy.get("summary"), dict) else {}
            hosts = post_deploy.get("hosts") if isinstance(post_deploy.get("hosts"), list) else []
            skipped_hosts = (
                post_deploy.get("skipped_hosts") if isinstance(post_deploy.get("skipped_hosts"), list) else []
            )
            normalized["post_deploy_summary"] = {
                "status": str(post_deploy.get("status") or summary.get("status") or "failed"),
                "host_count": int(summary.get("host_count") or len(hosts)),
                "skipped_host_count": int(summary.get("skipped_host_count") or len(skipped_hosts)),
                "service_count": int(summary.get("service_count") or 0),
                "health_summary": str(summary.get("health_summary") or "No health checks collected."),
                "collected_at": post_deploy.get("collected_at"),
            }
    if "post_deploy_hosts" not in normalized and isinstance(result, dict):
        post_deploy = result.get("post_deploy")
        if isinstance(post_deploy, dict) and isinstance(post_deploy.get("hosts"), list):
            normalized["post_deploy_hosts"] = post_deploy.get("hosts")
    return normalized


@router.get("/api/projects/{project_id}/opentofu/status")
async def opentofu_status(
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    status = await provisioning_service.get_opentofu_status(project.id)
    if not status["project_found"]:
        raise HTTPException(status_code=404, detail="Project not found")
    return status


@router.get("/api/projects/{project_id}/opentofu/deploy/preflight")
async def opentofu_deploy_preflight(
    review_session_id: str | None = Query(default=None),
    review_target: str = Query(default="apply"),
    scope_mode: str = Query(default="full"),
    selected_modules: list[str] = Query(default=[]),
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    execution_request = ProjectExecutionRequest(
        selected_modules=tuple(selected_modules),
        review_session_id=review_session_id,
        review_target=review_target,
        scope_mode=scope_mode,
    )
    opentofu_status = await provisioning_service.get_opentofu_status(project.id)
    ansible_status = await provisioning_service.get_ansible_status(project.id, settings)
    target_contract = provisioning_service.get_target_contract_status(project.id)
    ssm_readiness = await provisioning_service.get_ssm_readiness(
        project.id,
        settings,
        selected_modules if scope_mode == "partial" else [],
    )
    preflight = execution_policy.build_deploy_preflight_state(
        request=execution_request,
        opentofu_status=opentofu_status,
        ansible_status=ansible_status,
        target_contract=target_contract,
        resolved_review=await _resolved_review(
            project=project,
            request=execution_request,
        ),
        ssm_readiness=ssm_readiness,
    )
    return preflight.as_dict()


@router.post("/api/projects/{project_id}/opentofu/target-contract/validate")
async def opentofu_validate_target_contract(
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    return {"target_contract": provisioning_service.validate_target_contract(project.id, settings)}


@router.post("/api/projects/{project_id}/opentofu/deploy/preview")
async def opentofu_preview(
    body: OpenTofuPreviewBody,
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    data = await provisioning_service.preview_deploy(
        project_id=project.id,
        settings=settings,
        intent=body.intent,
    )
    if not data.get("project_found", True):
        raise HTTPException(status_code=404, detail="Project not found")
    return data


@router.post("/api/projects/{project_id}/opentofu/deploy/apply/stream")
async def opentofu_apply_stream(
    body: OpenTofuApplyBody,
    request: Request,
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> EventSourceResponse:
    return stream_enqueued_project_job(
        workflow_service=workflow_service,
        project=project,
        kind="apply",
        payload=_execution_request_from_body(body).to_job_payload(),
        request=request,
        fallback_error_code="opentofu_apply_failed",
    )


@router.get("/api/projects/{project_id}/runs/history")
async def runs_history(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    history = await workflow_service.list_jobs(
        project_id=project.id,
        user_id=str(project.user_id or ""),
        status=None,
        kind=None,
        limit=limit,
        offset=offset,
    )
    return {
        "total": history["total"],
        "items": [_history_item_with_post_deploy(item) for item in history["items"]],
    }


@router.post("/api/projects/{project_id}/opentofu/deploy/plan/stream")
async def opentofu_plan_stream(
    body: OpenTofuApplyBody,
    request: Request,
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> EventSourceResponse:
    return stream_enqueued_project_job(
        workflow_service=workflow_service,
        project=project,
        kind="plan",
        payload=_execution_request_from_body(body).to_job_payload(),
        request=request,
        fallback_error_code="opentofu_plan_failed",
    )


@router.post("/api/projects/{project_id}/opentofu/deploy/destroy/stream")
async def opentofu_destroy_stream(
    body: OpenTofuDestroyBody,
    request: Request,
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> EventSourceResponse:
    return stream_enqueued_project_job(
        workflow_service=workflow_service,
        project=project,
        kind="destroy",
        payload=_execution_request_from_body(body).to_job_payload(),
        request=request,
        fallback_error_code="opentofu_destroy_failed",
    )


@router.get("/api/projects/{project_id}/opentofu/costs")
async def opentofu_costs(
    module: str = Query(default="all"),
    refresh: bool = Query(default=False),
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    data = await provisioning_service.get_costs(
        project_id=project.id,
        settings=settings,
        module_scope=module,
        refresh=refresh,
    )
    if not data.get("project_found", True):
        raise HTTPException(status_code=404, detail="Project not found")
    if data.get("status") == "error" and _is_fatal_runtime_error(data):
        _raise_runtime_error(data)
    return data


@router.get("/api/projects/{project_id}/opentofu/graph")
async def opentofu_graph(
    module: str = Query(default="all"),
    type: str = Query(default="plan"),
    refresh: bool = Query(default=False),
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    data = await provisioning_service.get_graph(
        project_id=project.id,
        settings=settings,
        module_scope=module,
        graph_type=type,
        refresh=refresh,
    )
    if not data.get("project_found", True):
        raise HTTPException(status_code=404, detail="Project not found")
    if data.get("status") == "error" and _is_fatal_runtime_error(data):
        _raise_runtime_error(data)
    return data
