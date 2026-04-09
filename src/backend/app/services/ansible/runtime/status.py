"""Ansible runtime readiness/status helpers."""

from __future__ import annotations

from typing import Any

from app import db
from app.core.config import Settings
from app.services.generation_history import (
    ansible_generation_to_dict,
    get_latest_ansible_generation,
    get_latest_terraform_generation,
)
from app.services.opentofu.runtime import target_contract as target_contract_service
from app.services.opentofu.runtime.shared import discover_modules_from_project_dir, load_project
from app.services.project import credentials as project_credentials

from .shared import (
    ansible_available,
    resolve_playbook_path,
    resolve_project_root,
    resolve_ssh_key_path,
    resolve_ssm_bucket_name,
)
from .ssm_readiness import DEFAULT_SSM_READY_TIMEOUT_SECONDS, get_ssm_readiness
from .ssm_transport import SsmTransportError, apply_ssm_transport_config, build_ssm_transport_targets, transport_summary
from .summary import collect_config_visualization, read_latest_run_summary


def _discover_playbooks(project_id: str) -> list[str]:
    project_root = resolve_project_root(project_id)
    root = project_root / "playbooks"
    if not root.exists():
        return []
    playbooks: list[str] = []
    for suffix in ("*.yml", "*.yaml"):
        for path in root.rglob(suffix):
            if path.is_file():
                playbooks.append(path.relative_to(project_root).as_posix())
    playbooks.sort()
    return playbooks


async def _generation_state(project_id: str) -> dict[str, Any]:
    async with db.get_session() as session:
        latest_terraform_generation = await get_latest_terraform_generation(session, project_id)
        latest_ansible_generation = await get_latest_ansible_generation(session, project_id)

    target_modules = (
        sorted(str(item) for item in list(latest_ansible_generation.target_modules_json or []))
        if latest_ansible_generation
        else []
    )
    skipped_modules = (
        sorted(str(item) for item in list(latest_ansible_generation.skipped_modules_json or []))
        if latest_ansible_generation
        else []
    )
    summary = dict(latest_ansible_generation.summary_json or {}) if latest_ansible_generation else {}
    recorded_terraform_generation_id = str(summary.get("terraformGenerationId") or "")
    generation_stale = bool(
        latest_ansible_generation
        and latest_terraform_generation
        and recorded_terraform_generation_id != latest_terraform_generation.id
    )
    generation_ready = bool(
        latest_terraform_generation and latest_ansible_generation and not generation_stale and target_modules
    )
    return {
        "generationReady": generation_ready,
        "generationStale": generation_stale,
        "targetModules": target_modules,
        "skippedModules": skipped_modules,
        "latestGeneration": ansible_generation_to_dict(latest_ansible_generation),
        "latestTerraformGenerationId": latest_terraform_generation.id if latest_terraform_generation else None,
    }


def _configuration_required(target_contract: dict[str, Any]) -> bool:
    if str(target_contract.get("status") or "") != "valid":
        return True
    if bool(target_contract.get("stale")):
        return True
    return len(list(target_contract.get("targets") or [])) > 0


async def get_ansible_status(project_id: str, settings: Settings) -> dict[str, Any]:
    project = await load_project(project_id)
    available = ansible_available()
    if project is None:
        return {
            "project_found": False,
            "ansible_available": available,
            "provider": None,
            "key_ready": False,
            "playbooks": [],
            "playbook_path": settings.ansible_playbook_path,
            "modules": [],
            "host_count": 0,
            "missing_requirements": ["project_not_found"],
            "output_errors": [],
            "generationReady": False,
            "generationStale": False,
            "configurationRequired": True,
            "targetModules": [],
            "skippedModules": [],
            "ssm_ready": False,
            "ssm_readiness": {
                "status": "unvalidated",
                "blocking": True,
                "scope_mode": "full",
                "selected_modules": [],
                "checked_at": None,
                "timeout_seconds": DEFAULT_SSM_READY_TIMEOUT_SECONDS,
                "target_count": 0,
                "ready_target_count": 0,
                "pending_target_count": 0,
                "failed_target_count": 0,
                "blocker_code": "project_not_found",
                "blocker_message": "Project not found.",
                "targets": [],
                "failed_targets": [],
            },
            "latestGeneration": None,
            "config_summary": {
                "playbook_files": [],
                "role_task_files": [],
                "task_names": [],
                "package_targets": [],
                "service_targets": [],
                "file_targets": [],
                "module_usage_top": [],
            },
            "latest_run": None,
            "can_run": False,
        }

    project_root = resolve_project_root(project_id)
    playbook_path = resolve_playbook_path(project_root, settings)
    playbook_ready = playbook_path.is_file()
    playbooks = _discover_playbooks(project_id)
    modules = discover_modules_from_project_dir(project_id)
    target_contract = target_contract_service.get_target_contract_status(project_id)
    configuration_required = _configuration_required(target_contract)
    generation_state = await _generation_state(project_id)
    if not configuration_required and generation_state["latestTerraformGenerationId"] is not None:
        generation_state["generationReady"] = True
    target_modules = list(generation_state["targetModules"])
    provider = str(project.provider or "").strip()
    aws_transport = provider == "aws"
    ssm_readiness: dict[str, Any] = {
        "status": "unvalidated",
        "blocking": False,
        "scope_mode": "partial" if target_modules else "full",
        "selected_modules": target_modules,
        "checked_at": None,
        "timeout_seconds": DEFAULT_SSM_READY_TIMEOUT_SECONDS,
        "target_count": 0,
        "ready_target_count": 0,
        "pending_target_count": 0,
        "failed_target_count": 0,
        "blocker_code": None,
        "blocker_message": "",
        "targets": [],
        "failed_targets": [],
    }
    if generation_state["latestGeneration"] is not None and target_modules:
        ssm_readiness = await get_ssm_readiness(project_id, settings, target_modules)
    ssm_ready = bool(not ssm_readiness.get("blocking"))
    key_path = resolve_ssh_key_path(settings)
    key_ready = aws_transport or bool(key_path and key_path.is_file())
    host_count = 0
    output_errors: list[str] = []
    transport_error_code: str | None = None
    if (
        aws_transport
        and generation_state["latestGeneration"] is not None
        and target_modules
        and not ssm_readiness.get("blocking")
    ):
        try:
            targets = build_ssm_transport_targets(ssm_readiness)
            targets = apply_ssm_transport_config(
                targets,
                aws_region=str(project_credentials.parse_credentials(project.credentials).get("aws_region") or ""),
                bucket_name=str(resolve_ssm_bucket_name(settings) or ""),
            )
            host_count = int(transport_summary(targets)["target_count"])
        except SsmTransportError as exc:
            transport_error_code = exc.code
            output_errors.append(exc.message)
    elif aws_transport and generation_state["latestGeneration"] is not None and target_modules:
        host_count = int(ssm_readiness.get("target_count") or 0)
    elif target_modules:
        from .runner import collect_hosts_for_modules

        hosts, output_errors = await collect_hosts_for_modules(
            project_id=project_id,
            settings=settings,
            modules=target_modules,
            strict_state=False,
        )
        host_count = len(hosts)

    missing: list[str] = []
    if not modules:
        missing.append("modules_missing")
    if generation_state["latestTerraformGenerationId"] is None:
        missing.append("terraform_generation_missing")
    if configuration_required:
        if not available:
            missing.append("ansible_cli_unavailable")
        if not key_ready:
            missing.append("ssh_key_unavailable")
        if not playbook_ready:
            missing.append("playbook_missing")
        if generation_state["latestGeneration"] is None:
            missing.append("ansible_generation_missing")
        if generation_state["generationStale"]:
            missing.append("ansible_generation_stale")
        if generation_state["latestGeneration"] is not None and not target_modules:
            missing.append("ansible_generation_empty")
        if generation_state["latestGeneration"] is not None and target_modules and ssm_readiness.get("blocking"):
            blocker_code = str(ssm_readiness.get("blocker_code") or "").strip()
            if blocker_code:
                missing.append(blocker_code)
        if aws_transport and generation_state["latestGeneration"] is not None and target_modules:
            bucket_name = resolve_ssm_bucket_name(settings)
            if not bucket_name:
                missing.append("ssm_transport_bucket_missing")
            if transport_error_code and transport_error_code not in missing and not ssm_readiness.get("blocking"):
                missing.append(transport_error_code)
        else:
            if host_count == 0:
                missing.append("ansible_hosts_missing")
            if output_errors:
                missing.append("invalid_ansible_hosts_output")

    config_summary = collect_config_visualization(project_root)
    latest_run = read_latest_run_summary(project_root)

    return {
        "project_found": True,
        "ansible_available": available,
        "provider": project.provider,
        "key_ready": key_ready,
        "playbooks": playbooks,
        "playbook_path": str(playbook_path),
        "modules": modules,
        "host_count": host_count,
        "missing_requirements": missing,
        "output_errors": output_errors,
        "generationReady": generation_state["generationReady"],
        "generationStale": generation_state["generationStale"],
        "configurationRequired": configuration_required,
        "targetModules": target_modules,
        "skippedModules": generation_state["skippedModules"],
        "ssm_ready": ssm_ready,
        "ssm_readiness": ssm_readiness,
        "latestGeneration": generation_state["latestGeneration"],
        "config_summary": config_summary,
        "latest_run": latest_run,
        "can_run": configuration_required and len(missing) == 0,
    }
