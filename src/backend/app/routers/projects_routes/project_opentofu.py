"""OpenTofu deploy endpoints for projects."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sse_starlette import EventSourceResponse

from app.core.config import get_settings
from app.models import Project
from app.routers import auth_dependencies as auth_deps
from app.routers.projects_routes.streaming import stream_project_events
from app.services.ansible.runtime import status as ansible_status_service
from app.services.ansible.runtime.ssm_readiness import get_ssm_readiness
from app.services.opentofu import deploy as opentofu_deploy
from app.services.opentofu.runtime import review_gate
from app.services.opentofu.runtime import target_contract as target_contract_service
from app.services.project_execution import policy as execution_policy
from app.services.project_execution.contracts import ExecutionConfirmation, ProjectExecutionRequest
from app.services.state_backends import service as state_backends_service

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


async def _latest_successful_plan_result(project: Project) -> dict[str, Any] | None:
    return review_gate.load_recorded_plan_review(project.id)


async def _resolved_review(
    *,
    project: Project,
    request: ProjectExecutionRequest,
) -> dict[str, Any]:
    return review_gate.resolve_plan_review(
        project_id=project.id,
        review_result=await _latest_successful_plan_result(project),
        review_session_id=request.review_session_id,
        review_target=request.resolved_review_target(),
        scope_mode=request.effective_scope_mode(),
        selected_modules=request.selected_modules_list(),
    )


async def _apply_error_event(
    *,
    project: Project,
    request: ProjectExecutionRequest,
    settings,
) -> dict[str, Any] | None:
    opentofu_status = await opentofu_deploy.get_opentofu_status(project.id)
    ansible_status = await ansible_status_service.get_ansible_status(project.id, settings)
    drift_refresh = await state_backends_service.get_project_deploy_drift_summary(project.id)
    target_contract = target_contract_service.get_target_contract_status(project.id)
    ssm_readiness = await get_ssm_readiness(
        project.id,
        settings,
        request.selected_modules_list() if request.effective_scope_mode() == "partial" else [],
    )
    preflight = execution_policy.build_deploy_preflight_state(
        request=request,
        opentofu_status=opentofu_status,
        ansible_status=ansible_status,
        target_contract=target_contract,
        resolved_review=await _resolved_review(project=project, request=request),
        drift_refresh=drift_refresh,
        ssm_readiness=ssm_readiness,
    )
    if not preflight.primary_blocker_code:
        return None
    return {"type": "error", "code": preflight.primary_blocker_code, "message": preflight.primary_blocker_message}


async def _destroy_error_event(
    *,
    project: Project,
    request: ProjectExecutionRequest,
    settings,
) -> dict[str, Any] | None:
    opentofu_status = await opentofu_deploy.get_opentofu_status(project.id)
    credential_gate = execution_policy.build_credential_gate(opentofu_status)
    if credential_gate["blocking"]:
        return execution_policy.gate_error(
            "saved_credentials_incomplete",
            "Saved AWS credentials are incomplete.",
            missing_fields=list(credential_gate["missing_fields"]),
        )
    review_payload = execution_policy.build_review_gate_payload(
        resolved_review=await _resolved_review(project=project, request=request),
        request=request,
        review_target="destroy",
    )
    review_error = execution_policy.resolve_review_gate_error(review_payload, review_target="destroy")
    if review_error is not None:
        return review_error
    confirmation_error = execution_policy.resolve_destroy_confirmation_error(
        project_name=str(project.name or ""),
        request=request,
    )
    if confirmation_error is not None:
        return confirmation_error
    return None


async def _apply_event_stream(
    *,
    project: Project,
    request_body: ProjectExecutionRequest,
    settings,
    request: Request,
):
    error_event = await _apply_error_event(project=project, request=request_body, settings=settings)
    if error_event is not None:
        yield error_event
        yield {"type": "deploy.done", "status": "failed", "results": []}
        return
    async for event in opentofu_deploy.apply_modules_stream(
        project_id=project.id,
        settings=settings,
        selected_modules=request_body.selected_modules_list(),
        intent=request_body.intent,
        policy_override=request_body.option_enabled("override_policy"),
        cancel_checker=request.is_disconnected,
    ):
        yield event


async def _plan_event_stream(
    *,
    project: Project,
    request_body: ProjectExecutionRequest,
    settings,
    request: Request,
):
    final_status = "failed"
    final_results: list[dict[str, Any]] = []
    async for event in opentofu_deploy.plan_modules_stream(
        project_id=project.id,
        settings=settings,
        selected_modules=request_body.selected_modules_list(),
        intent=request_body.intent,
        destroy_plan=request_body.resolved_review_target() == "destroy",
        cancel_checker=request.is_disconnected,
    ):
        if event.get("type") == "plan.done":
            final_status = str(event.get("status") or "failed")
            final_results = event.get("results") if isinstance(event.get("results"), list) else []
        yield event
    if final_status == "ok":
        review_gate.save_recorded_plan_review(
            project_id=project.id,
            payload=review_gate.record_plan_review_metadata(
                project_id=project.id,
                result={"status": final_status, "results": final_results},
                review_session_id=request_body.review_session_id,
                review_target=request_body.review_target,
                scope_mode=request_body.scope_mode,
                selected_modules=request_body.selected_modules_list(),
            ),
        )


async def _destroy_event_stream(
    *,
    project: Project,
    request_body: ProjectExecutionRequest,
    settings,
    request: Request,
):
    error_event = await _destroy_error_event(project=project, request=request_body, settings=settings)
    if error_event is not None:
        yield error_event
        yield {"type": "destroy.done", "status": "failed", "results": []}
        return
    async for event in opentofu_deploy.destroy_modules_stream(
        project_id=project.id,
        settings=settings,
        selected_modules=request_body.selected_modules_list(),
        intent=request_body.intent,
        cancel_checker=request.is_disconnected,
    ):
        yield event


@router.get("/{project_id}/opentofu/status")
async def opentofu_status(project: Project = Depends(auth_deps.get_owned_project_or_404)) -> dict:
    status = await opentofu_deploy.get_opentofu_status(project.id)
    if not status["project_found"]:
        raise HTTPException(status_code=404, detail="Project not found")
    return status


@router.get("/{project_id}/opentofu/deploy/preflight")
async def opentofu_deploy_preflight(
    review_session_id: str | None = Query(default=None),
    review_target: str = Query(default="apply"),
    scope_mode: str = Query(default="full"),
    selected_modules: list[str] = Query(default=[]),
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    execution_request = ProjectExecutionRequest(
        selected_modules=tuple(selected_modules),
        review_session_id=review_session_id,
        review_target=review_target,
        scope_mode=scope_mode,
    )
    settings = get_settings()
    opentofu_status = await opentofu_deploy.get_opentofu_status(project.id)
    ansible_status = await ansible_status_service.get_ansible_status(project.id, settings)
    drift_refresh = await state_backends_service.get_project_deploy_drift_summary(project.id)
    target_contract = target_contract_service.get_target_contract_status(project.id)
    ssm_readiness = await get_ssm_readiness(
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
        drift_refresh=drift_refresh,
        ssm_readiness=ssm_readiness,
    )
    return preflight.as_dict()


@router.post("/{project_id}/opentofu/target-contract/validate")
async def opentofu_validate_target_contract(
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    return {"target_contract": target_contract_service.validate_target_contract(project.id, get_settings())}


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
    settings = get_settings()
    request_body = _execution_request_from_body(body)
    return stream_project_events(
        event_stream_factory=lambda: _apply_event_stream(
            project=project,
            request_body=request_body,
            settings=settings,
            request=request,
        ),
        request=request,
        fallback_error_code="opentofu_apply_failed",
    )


@router.get("/{project_id}/drift/status")
async def drift_status(project: Project = Depends(auth_deps.get_owned_project_or_404)) -> dict:
    return await state_backends_service.get_local_runtime_drift_status(
        project_id=project.id,
        user_id=str(project.user_id or ""),
    )


@router.post("/{project_id}/opentofu/deploy/plan/stream")
async def opentofu_plan_stream(
    body: OpenTofuApplyBody,
    request: Request,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> EventSourceResponse:
    settings = get_settings()
    request_body = _execution_request_from_body(body)
    return stream_project_events(
        event_stream_factory=lambda: _plan_event_stream(
            project=project,
            request_body=request_body,
            settings=settings,
            request=request,
        ),
        request=request,
        fallback_error_code="opentofu_plan_failed",
    )


@router.post("/{project_id}/opentofu/deploy/destroy/stream")
async def opentofu_destroy_stream(
    body: OpenTofuDestroyBody,
    request: Request,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> EventSourceResponse:
    settings = get_settings()
    request_body = _execution_request_from_body(body)
    return stream_project_events(
        event_stream_factory=lambda: _destroy_event_stream(
            project=project,
            request_body=request_body,
            settings=settings,
            request=request,
        ),
        request=request,
        fallback_error_code="opentofu_destroy_failed",
    )


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
