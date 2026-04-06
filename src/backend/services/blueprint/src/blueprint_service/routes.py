from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.shared.auth import dependencies as auth_deps

from .runtime import BlueprintKind, blueprint_persistence, blueprint_service
from .serializers import active_blueprints_to_dict, blueprint_input_to_dict, blueprint_step_to_dict

router = APIRouter()


class ActiveBlueprintUpdate(BaseModel):
    kind: BlueprintKind
    blueprint_id: str
    inputs: dict[str, str] = Field(default_factory=dict)


class BlueprintRunCreate(BaseModel):
    thread_id: str
    kind: BlueprintKind
    blueprint_id: str
    inputs: dict[str, str] = Field(default_factory=dict)


class TerraformGenerateBody(BaseModel):
    preview_token: str = ""
    confirm_write: bool = False


def _catalog_item_to_dict(definition: dict) -> dict:
    return {
        "id": definition["id"],
        "kind": definition["kind"],
        "name": definition["name"],
        "summary": definition["summary"],
        "resourcesOrActions": list(definition.get("resources_or_actions", [])),
        "requiredInputs": [blueprint_input_to_dict(item) for item in definition.get("required_inputs", [])],
        "steps": [blueprint_step_to_dict(step) for step in definition.get("steps", [])],
    }


def _snapshot_to_dict(snapshot: dict) -> dict:
    return {
        "id": snapshot["id"],
        "kind": snapshot["kind"],
        "version": snapshot["version"],
        "name": snapshot["name"],
        "summary": snapshot["summary"],
        "resourcesOrActions": list(snapshot.get("resources_or_actions", [])),
        "requiredInputs": [blueprint_input_to_dict(item) for item in snapshot.get("required_inputs", [])],
        "steps": [blueprint_step_to_dict(step) for step in snapshot.get("steps", [])],
    }


def _run_to_dict(run: blueprint_persistence.ProjectBlueprintRun) -> dict:
    return {
        "id": run.id,
        "projectId": run.project_id,
        "threadId": run.thread_id,
        "kind": run.kind,
        "blueprintId": run.blueprint_id,
        "blueprintVersion": run.blueprint_version,
        "blueprintName": run.blueprint_name,
        "inputs": dict(run.inputs_json or {}),
        "snapshot": _snapshot_to_dict(run.snapshot_json or {}),
        "createdAt": run.created_at.isoformat() if run.created_at else None,
    }


def _raise_generation_error(code: str) -> None:
    messages = {
        "project_not_found": "Project not found",
        "no_active_provisioning_blueprint": "No active provisioning blueprint is available for Terraform generation",
        "no_active_configuration_blueprint": "No active configuration blueprint is available for Ansible generation",
        "missing_blueprint_run_snapshot": "Latest approved provisioning blueprint snapshot is missing",
        "missing_configuration_blueprint_run_snapshot": "Latest approved configuration blueprint snapshot is missing",
        "unresolved_blueprint_inputs": "Blueprint inputs are still unresolved",
        "terraform_generation_confirmation_required": "Terraform generation requires explicit preview confirmation",
        "terraform_preview_stale": "Terraform preview is stale. Refresh the preview before generating again.",
        "terraform_generation_validation_failed": "Terraform generation failed validation",
        "terraform_template_not_found": "No Terraform template is registered for this provisioning blueprint",
        "missing_terraform_generation": "Terraform must be generated before configuration Ansible can be generated",
        "ansible_generation_confirmation_required": "Ansible generation requires explicit preview confirmation",
        "ansible_preview_stale": "Ansible preview is stale. Refresh the preview before generating again.",
        "ansible_generation_validation_failed": "Ansible generation failed validation",
        "configuration_ansible_template_not_found": "No configuration Ansible template is registered for this blueprint",
    }
    status_code = 400
    if code == "project_not_found":
        status_code = 404
    raise HTTPException(status_code=status_code, detail={"code": code, "message": messages.get(code, code)})


@router.get("/api/projects/{project_id}/blueprints/catalog")
async def get_blueprint_catalog(
    kind: BlueprintKind | None = Query(default=None),
    project: blueprint_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    del project
    return {"blueprints": [_catalog_item_to_dict(item) for item in blueprint_service.list_blueprints(kind)]}


@router.get("/api/projects/{project_id}/blueprints/active")
async def get_active_blueprints(
    project: blueprint_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    return active_blueprints_to_dict(project)


@router.put("/api/projects/{project_id}/blueprints/active")
async def update_active_blueprint(
    body: ActiveBlueprintUpdate,
    project: blueprint_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    async with blueprint_persistence.get_session() as session:
        try:
            await blueprint_service.set_active_blueprint(
                session,
                project,
                body.kind,
                body.blueprint_id,
                body.inputs,
            )
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
    return active_blueprints_to_dict(project)


@router.post("/api/projects/{project_id}/blueprints/runs")
async def create_blueprint_run(
    body: BlueprintRunCreate,
    project: blueprint_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    async with blueprint_persistence.get_session() as session:
        try:
            run = await blueprint_service.create_blueprint_run(
                session,
                project,
                body.thread_id,
                body.kind,
                body.blueprint_id,
                body.inputs,
            )
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"run": _run_to_dict(run)}


@router.get("/api/projects/{project_id}/blueprints/runs/{run_id}")
async def get_blueprint_run(
    run_id: str,
    project: blueprint_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    async with blueprint_persistence.get_session() as session:
        run = await blueprint_service.get_blueprint_run(session, project.id, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="blueprint_run_not_found")
    return {"run": _run_to_dict(run)}


@router.post("/api/projects/{project_id}/blueprints/provisioning/terraform/preview")
async def preview_provisioning_terraform(
    project: blueprint_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    async with blueprint_persistence.get_session() as session:
        try:
            preview = await blueprint_service.preview_provisioning_terraform(session, project.id)
        except ValueError as exc:
            _raise_generation_error(str(exc))
    return preview


@router.post("/api/projects/{project_id}/blueprints/configuration/ansible/preview")
async def preview_configuration_ansible(
    project: blueprint_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    async with blueprint_persistence.get_session() as session:
        try:
            preview = await blueprint_service.preview_configuration_ansible(session, project.id)
        except ValueError as exc:
            _raise_generation_error(str(exc))
    return preview


@router.post("/api/projects/{project_id}/blueprints/provisioning/terraform/generate")
async def generate_provisioning_terraform(
    body: TerraformGenerateBody,
    project: blueprint_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    async with blueprint_persistence.get_session() as session:
        try:
            result = await blueprint_service.generate_provisioning_terraform(
                project.id,
                session=session,
                preview_token=body.preview_token,
                confirm_write=body.confirm_write,
            )
        except ValueError as exc:
            _raise_generation_error(str(exc))
    return result


@router.post("/api/projects/{project_id}/blueprints/configuration/ansible/generate")
async def generate_configuration_ansible(
    body: TerraformGenerateBody,
    project: blueprint_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    async with blueprint_persistence.get_session() as session:
        try:
            result = await blueprint_service.generate_configuration_ansible(
                project.id,
                session=session,
                preview_token=body.preview_token,
                confirm_write=body.confirm_write,
            )
        except ValueError as exc:
            _raise_generation_error(str(exc))
    return result


@router.get("/api/projects/{project_id}/blueprints/provisioning/terraform/history")
async def list_provisioning_terraform_history(
    limit: int = Query(default=20, ge=1, le=100),
    project: blueprint_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    async with blueprint_persistence.get_session() as session:
        items = await blueprint_service.list_provisioning_terraform_history(
            session,
            project.id,
            limit=limit,
        )
    return {"items": items}


@router.get("/api/projects/{project_id}/blueprints/configuration/ansible/history")
async def list_configuration_ansible_history(
    limit: int = Query(default=20, ge=1, le=100),
    project: blueprint_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    async with blueprint_persistence.get_session() as session:
        items = await blueprint_service.list_configuration_ansible_history(
            session,
            project.id,
            limit=limit,
        )
    return {"items": items}


@router.get("/api/projects/{project_id}/blueprints/provisioning/terraform/history/{generation_id}")
async def get_provisioning_terraform_history_item(
    generation_id: str,
    project: blueprint_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    async with blueprint_persistence.get_session() as session:
        item = await blueprint_service.get_provisioning_terraform_history_item(
            session,
            project.id,
            generation_id,
        )
    if item is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "terraform_generation_not_found", "message": "Terraform generation history item not found"},
        )
    return {"generation": item}


@router.get("/api/projects/{project_id}/blueprints/configuration/ansible/history/{generation_id}")
async def get_configuration_ansible_history_item(
    generation_id: str,
    project: blueprint_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    async with blueprint_persistence.get_session() as session:
        item = await blueprint_service.get_configuration_ansible_history_item(
            session,
            project.id,
            generation_id,
        )
    if item is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "ansible_generation_not_found", "message": "Ansible generation history item not found"},
        )
    return {"generation": item}
