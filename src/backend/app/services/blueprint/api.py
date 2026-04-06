from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.blueprint import persistence as blueprint_persistence
from app.services.blueprints import (
    ansible_generation,
    terraform_generation,
)
from app.services.blueprints import (
    service as blueprint_service,
)
from app.services.blueprints.types import BlueprintKind


def list_blueprints(kind: BlueprintKind | None):
    return blueprint_service.list_blueprints(kind)


def get_active_blueprints(project: blueprint_persistence.Project):
    return blueprint_service.get_active_blueprints(project)


async def set_active_blueprint(
    session: AsyncSession,
    project: blueprint_persistence.Project,
    kind: BlueprintKind,
    blueprint_id: str,
    inputs: dict[str, str],
) -> None:
    await blueprint_service.set_active_blueprint(session, project, kind, blueprint_id, inputs)


async def create_blueprint_run(
    session: AsyncSession,
    project: blueprint_persistence.Project,
    thread_id: str,
    kind: BlueprintKind,
    blueprint_id: str,
    inputs: dict[str, str],
) -> blueprint_persistence.ProjectBlueprintRun:
    return await blueprint_service.create_blueprint_run(
        session,
        project,
        thread_id,
        kind,
        blueprint_id,
        inputs,
    )


async def get_blueprint_run(session: AsyncSession, project_id: str, run_id: str):
    return await blueprint_service.get_blueprint_run(session, project_id, run_id)


async def preview_provisioning_terraform(session: AsyncSession, project_id: str):
    return await terraform_generation.preview_provisioning_terraform(session, project_id)


async def preview_configuration_ansible(session: AsyncSession, project_id: str):
    return await ansible_generation.preview_configuration_ansible(session, project_id)


async def generate_provisioning_terraform(
    project_id: str,
    *,
    session: AsyncSession,
    preview_token: str,
    confirm_write: bool,
):
    return await terraform_generation.generate_provisioning_terraform(
        project_id,
        session=session,
        preview_token=preview_token,
        confirm_write=confirm_write,
    )


async def generate_configuration_ansible(
    project_id: str,
    *,
    session: AsyncSession,
    preview_token: str,
    confirm_write: bool,
):
    return await ansible_generation.generate_configuration_ansible(
        project_id,
        session=session,
        preview_token=preview_token,
        confirm_write=confirm_write,
    )


async def list_provisioning_terraform_history(session: AsyncSession, project_id: str, *, limit: int):
    return await terraform_generation.list_provisioning_terraform_history(session, project_id, limit=limit)


async def list_configuration_ansible_history(session: AsyncSession, project_id: str, *, limit: int):
    return await ansible_generation.list_configuration_ansible_history(session, project_id, limit=limit)


async def get_provisioning_terraform_history_item(
    session: AsyncSession,
    project_id: str,
    generation_id: str,
):
    return await terraform_generation.get_provisioning_terraform_history_item(session, project_id, generation_id)


async def get_configuration_ansible_history_item(
    session: AsyncSession,
    project_id: str,
    generation_id: str,
):
    return await ansible_generation.get_configuration_ansible_history_item(session, project_id, generation_id)
