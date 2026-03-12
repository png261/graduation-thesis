"""Project-scoped tools exposed to the deep agent."""

from __future__ import annotations

from typing import Any

from langchain.tools import tool

from app.core.config import Settings
from app.services.ansible import deploy as ansible_deploy
from app.services.opentofu import deploy as opentofu_deploy


async def _opentofu_tool_preview(
    project_id: str,
    settings: Settings,
    intent: str | None = None,
) -> dict:
    return await opentofu_deploy.preview_deploy(
        project_id=project_id,
        settings=settings,
        intent=intent,
    )


async def _opentofu_tool_apply(
    project_id: str,
    settings: Settings,
    selected_modules: list[str],
    confirm: bool = False,
    intent: str | None = None,
    override_policy: bool = False,
) -> dict:
    if not confirm:
        return {
            "status": "confirmation_required",
            "message": (
                "OpenTofu apply requires explicit user confirmation. "
                "Ask the user, then call opentofu_apply_deploy again with confirm=true."
            ),
            "selected_modules": selected_modules,
            "intent": intent or "",
        }
    result = await opentofu_deploy.apply_modules_collect(
        project_id=project_id,
        settings=settings,
        selected_modules=selected_modules,
        intent=intent,
        policy_override=override_policy,
    )
    return {"status": "ok" if result["final"]["status"] == "ok" else "failed", **result}


async def _ansible_tool_run(
    project_id: str,
    settings: Settings,
    selected_modules: list[str],
    confirm: bool = False,
    intent: str | None = None,
) -> dict:
    if not confirm:
        return {
            "status": "confirmation_required",
            "message": (
                "Ansible configuration run requires explicit user confirmation. "
                "Ask the user, then call ansible_run_config again with confirm=true."
            ),
            "selected_modules": selected_modules,
            "intent": intent or "",
        }
    result = await ansible_deploy.run_playbook_collect(
        project_id=project_id,
        settings=settings,
        selected_modules=selected_modules,
        intent=intent,
    )
    return {"status": "ok" if result["final"]["status"] == "ok" else "failed", **result}


def build_project_tools(settings: Settings, project_id: str) -> list[Any]:
    @tool("opentofu_preview_deploy")
    async def opentofu_preview_deploy(intent: str = "") -> dict:
        """Preview OpenTofu deploy targets for this project."""
        return await _opentofu_tool_preview(project_id, settings, intent or None)

    @tool("opentofu_apply_deploy")
    async def opentofu_apply_deploy(
        selected_modules: list[str],
        confirm: bool = False,
        intent: str = "",
        override_policy: bool = False,
    ) -> dict:
        """Apply selected OpenTofu modules after explicit confirmation."""
        return await _opentofu_tool_apply(
            project_id=project_id,
            settings=settings,
            selected_modules=selected_modules,
            confirm=confirm,
            intent=intent or None,
            override_policy=override_policy,
        )

    @tool("ansible_run_config")
    async def ansible_run_config(
        selected_modules: list[str],
        confirm: bool = False,
        intent: str = "",
    ) -> dict:
        """Run Ansible configuration for selected modules after explicit confirmation."""
        return await _ansible_tool_run(
            project_id=project_id,
            settings=settings,
            selected_modules=selected_modules,
            confirm=confirm,
            intent=intent or None,
        )

    return [
        opentofu_preview_deploy,
        opentofu_apply_deploy,
        ansible_run_config,
    ]
