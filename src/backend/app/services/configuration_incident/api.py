from __future__ import annotations

from typing import Any

from app.core.config import Settings
from app.services.ansible import deploy as ansible_deploy
from app.services.ansible.runtime.ssm_readiness import wait_for_ssm_readiness as wait_for_ssm_readiness_impl
from app.services.incident import service as incident_service


async def get_ansible_status(project_id: str, settings: Settings) -> dict[str, Any]:
    return await ansible_deploy.get_ansible_status(project_id, settings)


async def list_incident_summaries(*, project_id: str, limit: int) -> list[dict[str, Any]]:
    return await incident_service.list_summaries(project_id=project_id, limit=limit)


async def get_incident_summary(*, project_id: str, incident_id: str) -> dict[str, Any]:
    return await incident_service.get_summary(project_id=project_id, incident_id=incident_id)


async def mark_incident_resolution_quality(
    *,
    project_id: str,
    incident_id: str,
    quality: str,
) -> dict[str, Any]:
    return await incident_service.mark_resolution_quality(
        project_id=project_id,
        incident_id=incident_id,
        quality=quality,
    )


async def get_incident_metrics(*, project_id: str) -> dict[str, Any]:
    return await incident_service.get_metrics(project_id=project_id)


def run_playbook_stream(
    *,
    project_id: str,
    settings: Settings,
    selected_modules: list[str],
    intent: str | None,
    cancel_checker,
):
    return ansible_deploy.run_playbook_stream(
        project_id=project_id,
        settings=settings,
        selected_modules=selected_modules,
        intent=intent,
        cancel_checker=cancel_checker,
    )


async def collect_post_deploy_result(
    *,
    project_id: str,
    settings: Settings,
    selected_modules: list[str],
    checks: dict[str, Any] | None,
    successful_hosts: list[str] | None,
    skipped_hosts: list[str],
    cancel_checker,
    progress,
) -> dict[str, Any]:
    return await ansible_deploy.collect_post_deploy_result(
        project_id=project_id,
        settings=settings,
        selected_modules=selected_modules,
        checks=checks,
        successful_hosts=successful_hosts,
        skipped_hosts=skipped_hosts,
        cancel_checker=cancel_checker,
        progress=progress,
    )


async def wait_for_ssm_readiness(
    project_id: str,
    settings: Settings,
    selected_modules: list[str],
    *,
    cancel_checker,
    progress,
) -> dict[str, Any]:
    return await wait_for_ssm_readiness_impl(
        project_id,
        settings,
        selected_modules,
        cancel_checker=cancel_checker,
        progress=progress,
    )
