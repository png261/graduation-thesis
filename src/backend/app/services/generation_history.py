from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ProjectAnsibleGeneration, ProjectTerraformGeneration


async def get_latest_terraform_generation(
    session: AsyncSession,
    project_id: str,
) -> ProjectTerraformGeneration | None:
    result = await session.execute(
        select(ProjectTerraformGeneration)
        .where(ProjectTerraformGeneration.project_id == project_id)
        .order_by(ProjectTerraformGeneration.created_at.desc())
        .limit(1)
    )
    return result.scalars().first()


async def get_latest_ansible_generation(
    session: AsyncSession,
    project_id: str,
) -> ProjectAnsibleGeneration | None:
    result = await session.execute(
        select(ProjectAnsibleGeneration)
        .where(ProjectAnsibleGeneration.project_id == project_id)
        .order_by(ProjectAnsibleGeneration.created_at.desc())
        .limit(1)
    )
    return result.scalars().first()


def ansible_generation_to_dict(
    record: ProjectAnsibleGeneration | None,
    *,
    compare_to_previous: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    if record is None:
        return None
    return {
        "id": record.id,
        "projectId": record.project_id,
        "playbookPath": record.playbook_path,
        "targetModules": list(record.target_modules_json or []),
        "skippedModules": list(record.skipped_modules_json or []),
        "generatedPaths": dict(record.generated_paths_json or {}),
        "summary": dict(record.summary_json or {}),
        "provenanceReportPath": record.provenance_report_path,
        "replacesGenerationId": record.replaces_generation_id,
        "createdAt": record.created_at.isoformat() if record.created_at else None,
        "compare": compare_to_previous,
    }
