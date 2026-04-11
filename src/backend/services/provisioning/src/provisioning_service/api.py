from __future__ import annotations

from typing import Any

from app.core.config import Settings

from .backend import (
    get_ansible_status_impl,
    get_ssm_readiness_impl,
    opentofu_deploy,
    review_gate,
    target_contract_service,
)


async def get_opentofu_status(project_id: str) -> dict[str, Any]:
    return await opentofu_deploy.get_opentofu_status(project_id)


async def get_ansible_status(project_id: str, settings: Settings) -> dict[str, Any]:
    return await get_ansible_status_impl(project_id, settings)


async def get_ssm_readiness(project_id: str, settings: Settings, selected_modules: list[str]) -> dict[str, Any]:
    return await get_ssm_readiness_impl(project_id, settings, selected_modules)


def get_target_contract_status(project_id: str) -> dict[str, Any]:
    return target_contract_service.get_target_contract_status(project_id)


def validate_target_contract(project_id: str, settings: Settings) -> dict[str, Any]:
    return target_contract_service.validate_target_contract(project_id, settings)


def resolve_plan_review(
    *,
    project_id: str,
    review_result: dict[str, Any] | None,
    review_session_id: str | None = None,
    review_target: str = "apply",
    scope_mode: str = "full",
    selected_modules: list[str] | None = None,
) -> dict[str, Any]:
    return review_gate.resolve_plan_review(
        project_id=project_id,
        review_result=review_result,
        review_session_id=review_session_id,
        review_target=review_target,
        scope_mode=scope_mode,
        selected_modules=selected_modules,
    )


def load_recorded_plan_review(project_id: str) -> dict[str, Any] | None:
    return review_gate.load_recorded_plan_review(project_id)


async def preview_deploy(*, project_id: str, settings: Settings, intent: str | None) -> dict[str, Any]:
    return await opentofu_deploy.preview_deploy(project_id=project_id, settings=settings, intent=intent)


def apply_modules_stream(
    *,
    project_id: str,
    settings: Settings,
    selected_modules: list[str],
    intent: str | None,
    policy_override: bool,
    cancel_checker,
):
    return opentofu_deploy.apply_modules_stream(
        project_id=project_id,
        settings=settings,
        selected_modules=selected_modules,
        intent=intent,
        policy_override=policy_override,
        cancel_checker=cancel_checker,
    )


def plan_modules_stream(
    *,
    project_id: str,
    settings: Settings,
    selected_modules: list[str],
    intent: str | None,
    destroy_plan: bool,
    cancel_checker,
):
    return opentofu_deploy.plan_modules_stream(
        project_id=project_id,
        settings=settings,
        selected_modules=selected_modules,
        intent=intent,
        destroy_plan=destroy_plan,
        cancel_checker=cancel_checker,
    )


def destroy_modules_stream(
    *,
    project_id: str,
    settings: Settings,
    selected_modules: list[str],
    intent: str | None,
    cancel_checker,
):
    return opentofu_deploy.destroy_modules_stream(
        project_id=project_id,
        settings=settings,
        selected_modules=selected_modules,
        intent=intent,
        cancel_checker=cancel_checker,
    )


async def get_costs(
    *,
    project_id: str,
    settings: Settings,
    module_scope: str,
    refresh: bool,
) -> dict[str, Any]:
    return await opentofu_deploy.get_costs(
        project_id=project_id,
        settings=settings,
        module_scope=module_scope,
        refresh=refresh,
    )


async def get_graph(
    *,
    project_id: str,
    settings: Settings,
    module_scope: str,
    graph_type: str,
    refresh: bool,
) -> dict[str, Any]:
    return await opentofu_deploy.get_graph(
        project_id=project_id,
        settings=settings,
        module_scope=module_scope,
        graph_type=graph_type,
        refresh=refresh,
    )


def record_plan_review_metadata(
    *,
    project_id: str,
    result: dict[str, Any],
    review_session_id: str | None,
    review_target: str | None,
    scope_mode: str | None,
    selected_modules: list[str],
) -> dict[str, Any]:
    return review_gate.record_plan_review_metadata(
        project_id=project_id,
        result=result,
        review_session_id=review_session_id,
        review_target=review_target,
        scope_mode=scope_mode,
        selected_modules=selected_modules,
    )
