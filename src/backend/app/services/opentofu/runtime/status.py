"""OpenTofu status and preview flows."""
from __future__ import annotations

from typing import Any

from app.core.config import Settings
from app.services.project import credentials as project_credentials

from .selector import select_modules_for_deploy
from .shared import (
    discover_modules_from_project_dir,
    load_project,
    opentofu_available,
    required_credential_fields,
)


async def get_opentofu_status(project_id: str) -> dict[str, Any]:
    project = await load_project(project_id)
    if project is None:
        return {
            "project_found": False,
            "opentofu_available": opentofu_available(),
            "provider": None,
            "credential_ready": False,
            "missing_credentials": [],
            "modules": [],
            "can_deploy": False,
        }

    creds = project_credentials.parse_credentials(project.credentials)
    required = required_credential_fields(project.provider)
    missing = [field for field in required if not creds.get(field)]
    modules = discover_modules_from_project_dir(project_id)
    available = opentofu_available()
    credential_ready = len(missing) == 0 and bool(project.provider)
    return {
        "project_found": True,
        "opentofu_available": available,
        "provider": project.provider,
        "credential_ready": credential_ready,
        "missing_credentials": missing,
        "modules": modules,
        "can_deploy": available and credential_ready and len(modules) > 0,
    }


async def preview_deploy(
    *,
    project_id: str,
    settings: Settings,
    intent: str | None = None,
) -> dict[str, Any]:
    status = await get_opentofu_status(project_id)
    if not status["project_found"]:
        return {"status": "error", "message": "Project not found", **status}

    if not status["opentofu_available"]:
        return {"status": "error", "message": "OpenTofu CLI is not available", **status}

    selection = await select_modules_for_deploy(
        project_id=project_id,
        settings=settings,
        provider=status.get("provider"),
        modules=status.get("modules", []),
        intent=intent,
    )
    return {
        "status": "ok",
        "intent": intent or "",
        **status,
        **selection,
    }
