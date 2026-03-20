from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Project,
    ProjectAnsibleGeneration,
    ProjectBlueprintRun,
    ProjectTerraformGeneration,
)
from app.services.blueprints.catalog import BLUEPRINT_CATALOG
from app.services.blueprints.types import (
    ActiveBlueprintSelection,
    BlueprintDefinition,
    BlueprintHealthCheckDefinition,
    BlueprintInputDefinition,
    BlueprintKind,
    BlueprintPostDeployChecks,
    BlueprintRunSnapshot,
    BlueprintServiceLogDefinition,
)


def _copy_input_definition(definition: BlueprintInputDefinition) -> BlueprintInputDefinition:
    return dict(definition)


def _copy_step_definition(definition: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": definition["id"],
        "type": definition["type"],
        "title": definition["title"],
        "description": definition["description"],
        "required_inputs": list(definition.get("required_inputs", [])),
        "expected_result": definition["expected_result"],
    }


def _copy_health_check(definition: BlueprintHealthCheckDefinition) -> BlueprintHealthCheckDefinition:
    return dict(definition)


def _copy_service_log(definition: BlueprintServiceLogDefinition) -> BlueprintServiceLogDefinition:
    return dict(definition)


def _copy_post_deploy_checks(
    checks: BlueprintPostDeployChecks | None,
) -> BlueprintPostDeployChecks | None:
    if not isinstance(checks, dict):
        return None
    return {
        "services": [str(item) for item in checks.get("services", []) if isinstance(item, str)],
        "package_versions": [
            str(item) for item in checks.get("package_versions", []) if isinstance(item, str)
        ],
        "health_checks": [
            _copy_health_check(item) for item in checks.get("health_checks", []) if isinstance(item, dict)
        ],
        "service_logs": [
            _copy_service_log(item) for item in checks.get("service_logs", []) if isinstance(item, dict)
        ],
    }


def _copy_blueprint(definition: BlueprintDefinition) -> BlueprintDefinition:
    copied: BlueprintDefinition = {
        "id": definition["id"],
        "kind": definition["kind"],
        "version": definition["version"],
        "name": definition["name"],
        "summary": definition["summary"],
        "resources_or_actions": list(definition["resources_or_actions"]),
        "required_inputs": [_copy_input_definition(item) for item in definition["required_inputs"]],
        "steps": [_copy_step_definition(step) for step in definition["steps"]],
    }
    post_deploy_checks = _copy_post_deploy_checks(definition.get("post_deploy_checks"))
    if post_deploy_checks is not None:
        copied["post_deploy_checks"] = post_deploy_checks
    return copied


def _normalize_inputs(inputs: dict[str, Any], definitions: list[BlueprintInputDefinition]) -> dict[str, str]:
    normalized = {str(key): str(value) for key, value in inputs.items() if value not in (None, "")}
    for definition in definitions:
        default_value = definition.get("default_value")
        if default_value is not None and definition["key"] not in normalized:
            normalized[definition["key"]] = str(default_value)
    return normalized


def _resolved_required_inputs(
    definition: BlueprintDefinition,
    inputs: dict[str, str],
) -> list[BlueprintInputDefinition]:
    resolved: list[BlueprintInputDefinition] = []
    for item in definition["required_inputs"]:
        definition_copy = _copy_input_definition(item)
        value = inputs.get(item["key"])
        definition_copy["resolved"] = value is not None
        definition_copy["value"] = value
        resolved.append(definition_copy)
    return resolved


def _selection_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def _selection_from_definition(
    definition: BlueprintDefinition,
    inputs: dict[str, str],
) -> ActiveBlueprintSelection:
    selection: ActiveBlueprintSelection = {
        "kind": definition["kind"],
        "blueprint_id": definition["id"],
        "blueprint_version": definition["version"],
        "blueprint_name": definition["name"],
        "summary": definition["summary"],
        "resources_or_actions": list(definition["resources_or_actions"]),
        "required_inputs": _resolved_required_inputs(definition, inputs),
        "steps": [_copy_step_definition(step) for step in definition["steps"]],
        "inputs": dict(inputs),
        "selected_at": _selection_timestamp(),
        "latest_run_id": None,
        "latest_run_created_at": None,
    }
    post_deploy_checks = _copy_post_deploy_checks(definition.get("post_deploy_checks"))
    if post_deploy_checks is not None:
        selection["post_deploy_checks"] = post_deploy_checks
    return selection


def _ranked_score(definition: BlueprintDefinition, request_text: str) -> int:
    haystack = " ".join(
        [
            definition["name"],
            definition["summary"],
            " ".join(definition["resources_or_actions"]),
            " ".join(step["title"] for step in definition["steps"]),
            " ".join(item["label"] for item in definition["required_inputs"]),
        ]
    ).lower()
    tokens = [token for token in request_text.lower().split() if token]
    return sum(2 if token in definition["name"].lower() else 1 for token in tokens if token in haystack)


def list_blueprints(kind: BlueprintKind | None = None) -> list[BlueprintDefinition]:
    if kind is None:
        return [_copy_blueprint(item) for item in BLUEPRINT_CATALOG]
    return [_copy_blueprint(item) for item in BLUEPRINT_CATALOG if item["kind"] == kind]


def get_blueprint_definition(kind: BlueprintKind, blueprint_id: str) -> BlueprintDefinition:
    for definition in BLUEPRINT_CATALOG:
        if definition["kind"] == kind and definition["id"] == blueprint_id:
            return _copy_blueprint(definition)
    raise ValueError("blueprint_not_found")


def rank_blueprints_for_request(
    request_text: str,
    kind: BlueprintKind,
    limit: int = 3,
) -> list[BlueprintDefinition]:
    ranked = list_blueprints(kind)
    ranked.sort(key=lambda item: (_ranked_score(item, request_text), item["name"]), reverse=True)
    return ranked[:limit]


def build_blueprint_snapshot(
    definition: BlueprintDefinition,
    inputs: dict[str, Any],
) -> BlueprintRunSnapshot:
    normalized_inputs = _normalize_inputs(inputs, definition["required_inputs"])
    snapshot: BlueprintRunSnapshot = {
        "id": definition["id"],
        "kind": definition["kind"],
        "version": definition["version"],
        "name": definition["name"],
        "summary": definition["summary"],
        "resources_or_actions": list(definition["resources_or_actions"]),
        "required_inputs": _resolved_required_inputs(definition, normalized_inputs),
        "steps": [_copy_step_definition(step) for step in definition["steps"]],
    }
    post_deploy_checks = _copy_post_deploy_checks(definition.get("post_deploy_checks"))
    if post_deploy_checks is not None:
        snapshot["post_deploy_checks"] = post_deploy_checks
    return snapshot


def get_active_blueprints(project: Project) -> dict[str, ActiveBlueprintSelection | None]:
    stored = project.active_blueprints_json if isinstance(project.active_blueprints_json, dict) else {}
    return {
        "provisioning": stored.get("provisioning"),
        "configuration": stored.get("configuration"),
    }


def get_active_blueprint_selection(
    project: Project,
    kind: BlueprintKind,
) -> ActiveBlueprintSelection | None:
    return get_active_blueprints(project).get(kind)


async def set_active_blueprint(
    session: AsyncSession,
    project: Project,
    kind: BlueprintKind,
    blueprint_id: str,
    inputs: dict[str, Any],
) -> ActiveBlueprintSelection:
    managed_project = await session.get(Project, project.id)
    if managed_project is None:
        raise ValueError("project_not_found")
    definition = get_blueprint_definition(kind, blueprint_id)
    normalized_inputs = _normalize_inputs(inputs, definition["required_inputs"])
    active = get_active_blueprints(managed_project)
    active[kind] = _selection_from_definition(definition, normalized_inputs)
    managed_project.active_blueprints_json = active
    project.active_blueprints_json = active
    await session.flush()
    return active[kind]


async def create_blueprint_run(
    session: AsyncSession,
    project: Project,
    thread_id: str,
    kind: BlueprintKind,
    blueprint_id: str,
    inputs: dict[str, Any],
) -> ProjectBlueprintRun:
    managed_project = await session.get(Project, project.id)
    if managed_project is None:
        raise ValueError("project_not_found")
    definition = get_blueprint_definition(kind, blueprint_id)
    normalized_inputs = _normalize_inputs(inputs, definition["required_inputs"])
    run = ProjectBlueprintRun(
        id=str(uuid.uuid4()),
        project_id=managed_project.id,
        thread_id=thread_id,
        kind=kind,
        blueprint_id=definition["id"],
        blueprint_version=definition["version"],
        blueprint_name=definition["name"],
        inputs_json=normalized_inputs,
        snapshot_json=build_blueprint_snapshot(definition, normalized_inputs),
        created_at=datetime.now(timezone.utc),
    )
    session.add(run)
    active = get_active_blueprints(managed_project)
    selection = active.get(kind)
    if selection is not None:
        selection["latest_run_id"] = run.id
        selection["latest_run_created_at"] = run.created_at.isoformat()
        managed_project.active_blueprints_json = active
        project.active_blueprints_json = active
    await session.flush()
    return run


async def get_blueprint_run(
    session: AsyncSession,
    project_id: str,
    run_id: str,
) -> ProjectBlueprintRun | None:
    run = await session.get(ProjectBlueprintRun, run_id)
    if run is None or run.project_id != project_id:
        return None
    return run


async def get_latest_blueprint_run(
    session: AsyncSession,
    project: Project,
    kind: BlueprintKind,
) -> ProjectBlueprintRun | None:
    selection = get_active_blueprint_selection(project, kind)
    if selection is None:
        return None
    run_id = selection.get("latest_run_id")
    if not run_id:
        return None
    return await get_blueprint_run(session, project.id, run_id)


def _generated_paths_digest(payload: dict[str, str]) -> dict[str, str]:
    normalized: dict[str, str] = {}
    for path, digest in payload.items():
        if not path:
            continue
        normalized[str(path)] = str(digest)
    return normalized


def _module_names_payload(module_names: list[str]) -> list[str]:
    return sorted({item.strip() for item in module_names if isinstance(item, str) and item.strip()})


def _sort_generations(items: list[ProjectTerraformGeneration]) -> list[ProjectTerraformGeneration]:
    return sorted(
        items,
        key=lambda item: item.created_at.isoformat() if item.created_at else "",
        reverse=True,
    )


async def _load_terraform_generations(
    session: AsyncSession,
    project_id: str,
) -> list[ProjectTerraformGeneration]:
    if hasattr(session, "_terraform_generations"):
        raw = getattr(session, "_terraform_generations")
        return _sort_generations([item for item in raw.values() if item.project_id == project_id])
    rows = await session.execute(
        select(ProjectTerraformGeneration)
        .where(ProjectTerraformGeneration.project_id == project_id)
        .order_by(ProjectTerraformGeneration.created_at.desc())
    )
    return list(rows.scalars().all())


def _sort_ansible_generations(items: list[ProjectAnsibleGeneration]) -> list[ProjectAnsibleGeneration]:
    return sorted(
        items,
        key=lambda item: item.created_at.isoformat() if item.created_at else "",
        reverse=True,
    )


async def _load_ansible_generations(
    session: AsyncSession,
    project_id: str,
) -> list[ProjectAnsibleGeneration]:
    if hasattr(session, "_ansible_generations"):
        raw = getattr(session, "_ansible_generations")
        return _sort_ansible_generations([item for item in raw.values() if item.project_id == project_id])
    rows = await session.execute(
        select(ProjectAnsibleGeneration)
        .where(ProjectAnsibleGeneration.project_id == project_id)
        .order_by(ProjectAnsibleGeneration.created_at.desc())
    )
    return list(rows.scalars().all())


async def create_terraform_generation_record(
    session: AsyncSession,
    *,
    project_id: str,
    blueprint_run_id: str,
    stack_path: str,
    generated_paths: dict[str, str],
    module_names: list[str],
    summary: dict[str, Any],
    provenance_report_path: str,
    replaces_generation_id: str | None = None,
) -> ProjectTerraformGeneration:
    record = ProjectTerraformGeneration(
        id=str(uuid.uuid4()),
        project_id=project_id,
        blueprint_run_id=blueprint_run_id,
        stack_path=stack_path,
        generated_paths_json=_generated_paths_digest(generated_paths),
        module_names_json=_module_names_payload(module_names),
        summary_json=dict(summary),
        provenance_report_path=provenance_report_path,
        replaces_generation_id=replaces_generation_id,
        created_at=datetime.now(timezone.utc),
    )
    session.add(record)
    await session.flush()
    return record


async def list_terraform_generations(
    session: AsyncSession,
    project_id: str,
    limit: int = 20,
) -> list[ProjectTerraformGeneration]:
    rows = await _load_terraform_generations(session, project_id)
    return rows[: max(1, int(limit))]


async def get_terraform_generation(
    session: AsyncSession,
    project_id: str,
    generation_id: str,
) -> ProjectTerraformGeneration | None:
    if hasattr(session, "_terraform_generations"):
        record = getattr(session, "_terraform_generations").get(generation_id)
    else:
        record = await session.get(ProjectTerraformGeneration, generation_id)
    if record is None or record.project_id != project_id:
        return None
    return record


async def get_latest_terraform_generation(
    session: AsyncSession,
    project_id: str,
) -> ProjectTerraformGeneration | None:
    rows = await list_terraform_generations(session, project_id, limit=1)
    return rows[0] if rows else None


async def create_ansible_generation_record(
    session: AsyncSession,
    *,
    project_id: str,
    blueprint_run_id: str,
    playbook_path: str,
    target_modules: list[str],
    skipped_modules: list[str],
    generated_paths: dict[str, str],
    summary: dict[str, Any],
    provenance_report_path: str,
    replaces_generation_id: str | None = None,
) -> ProjectAnsibleGeneration:
    record = ProjectAnsibleGeneration(
        id=str(uuid.uuid4()),
        project_id=project_id,
        blueprint_run_id=blueprint_run_id,
        playbook_path=playbook_path,
        target_modules_json=_module_names_payload(target_modules),
        skipped_modules_json=_module_names_payload(skipped_modules),
        generated_paths_json=_generated_paths_digest(generated_paths),
        summary_json=dict(summary),
        provenance_report_path=provenance_report_path,
        replaces_generation_id=replaces_generation_id,
        created_at=datetime.now(timezone.utc),
    )
    session.add(record)
    await session.flush()
    return record


async def list_ansible_generations(
    session: AsyncSession,
    project_id: str,
    limit: int = 20,
) -> list[ProjectAnsibleGeneration]:
    rows = await _load_ansible_generations(session, project_id)
    return rows[: max(1, int(limit))]


async def get_ansible_generation(
    session: AsyncSession,
    project_id: str,
    generation_id: str,
) -> ProjectAnsibleGeneration | None:
    if hasattr(session, "_ansible_generations"):
        record = getattr(session, "_ansible_generations").get(generation_id)
    else:
        record = await session.get(ProjectAnsibleGeneration, generation_id)
    if record is None or record.project_id != project_id:
        return None
    return record


async def get_latest_ansible_generation(
    session: AsyncSession,
    project_id: str,
) -> ProjectAnsibleGeneration | None:
    rows = await list_ansible_generations(session, project_id, limit=1)
    return rows[0] if rows else None


def compare_terraform_generations(
    current: ProjectTerraformGeneration,
    previous: ProjectTerraformGeneration | None,
) -> dict[str, Any]:
    current_paths = _generated_paths_digest(current.generated_paths_json or {})
    current_modules = _module_names_payload(list(current.module_names_json or []))
    if previous is None:
        return {
            "hasPrevious": False,
            "addedModules": current_modules,
            "removedModules": [],
            "changedModules": [],
            "addedFiles": sorted(current_paths),
            "removedFiles": [],
            "changedFiles": [],
            "inputsChanged": False,
        }

    previous_paths = _generated_paths_digest(previous.generated_paths_json or {})
    previous_modules = _module_names_payload(list(previous.module_names_json or []))

    added_modules = sorted(set(current_modules) - set(previous_modules))
    removed_modules = sorted(set(previous_modules) - set(current_modules))
    changed_files = sorted(
        path
        for path in set(current_paths).intersection(previous_paths)
        if current_paths[path] != previous_paths[path]
    )
    changed_modules = sorted(
        module
        for module in set(current_modules).intersection(previous_modules)
        if any(path.startswith(f"/modules/{module}/") for path in changed_files)
    )
    current_inputs = dict((current.summary_json or {}).get("inputs", {}))
    previous_inputs = dict((previous.summary_json or {}).get("inputs", {}))
    return {
        "hasPrevious": True,
        "previousGenerationId": previous.id,
        "addedModules": added_modules,
        "removedModules": removed_modules,
        "changedModules": changed_modules,
        "addedFiles": sorted(set(current_paths) - set(previous_paths)),
        "removedFiles": sorted(set(previous_paths) - set(current_paths)),
        "changedFiles": changed_files,
        "inputsChanged": current_inputs != previous_inputs,
    }


def compare_ansible_generations(
    current: ProjectAnsibleGeneration,
    previous: ProjectAnsibleGeneration | None,
) -> dict[str, Any]:
    current_paths = _generated_paths_digest(current.generated_paths_json or {})
    current_modules = _module_names_payload(list(current.target_modules_json or []))
    if previous is None:
        return {
            "hasPrevious": False,
            "addedModules": current_modules,
            "removedModules": [],
            "changedModules": [],
            "addedFiles": sorted(current_paths),
            "removedFiles": [],
            "changedFiles": [],
            "inputsChanged": False,
        }

    previous_paths = _generated_paths_digest(previous.generated_paths_json or {})
    previous_modules = _module_names_payload(list(previous.target_modules_json or []))
    added_modules = sorted(set(current_modules) - set(previous_modules))
    removed_modules = sorted(set(previous_modules) - set(current_modules))
    changed_files = sorted(
        path
        for path in set(current_paths).intersection(previous_paths)
        if current_paths[path] != previous_paths[path]
    )
    changed_modules = sorted(
        module
        for module in set(current_modules).intersection(previous_modules)
        if any(path.startswith(f"/roles/{module}/") for path in changed_files)
    )
    current_inputs = dict((current.summary_json or {}).get("inputs", {}))
    previous_inputs = dict((previous.summary_json or {}).get("inputs", {}))
    return {
        "hasPrevious": True,
        "previousGenerationId": previous.id,
        "addedModules": added_modules,
        "removedModules": removed_modules,
        "changedModules": changed_modules,
        "addedFiles": sorted(set(current_paths) - set(previous_paths)),
        "removedFiles": sorted(set(previous_paths) - set(current_paths)),
        "changedFiles": changed_files,
        "inputsChanged": current_inputs != previous_inputs,
    }


def preview_token_from_payload(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()
