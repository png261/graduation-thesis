"""Project-scoped tools exposed to the deep agent."""

from __future__ import annotations

import logging
from typing import Any

from langchain.tools import tool

from app.core.config import Settings
from app.services.ansible import deploy as ansible_deploy
from app.services.opentofu import deploy as opentofu_deploy
from app.services.project import files as project_files

from .iac_templates import validate_iac_structure

logger = logging.getLogger(__name__)


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
    final = result["final"] if isinstance(result.get("final"), dict) else {}
    return {
        "status": "ok" if final.get("status") == "ok" else "failed",
        "transport": final.get("transport"),
        "selected_modules": final.get("selected_modules", []),
        "target_count": final.get("target_count", 0),
        "target_ids": final.get("target_ids", []),
        **result,
    }


def _sanitize_selected_modules(selected_modules: list[str] | None) -> list[str]:
    if not selected_modules:
        return []
    names: list[str] = []
    for row in selected_modules:
        if not isinstance(row, str):
            continue
        value = row.strip()
        if value:
            names.append(value)
    return names


async def _iac_structure_tool_validate(project_id: str, selected_modules: list[str] | None = None) -> dict:
    root = project_files.ensure_project_dir(project_id)
    modules = _sanitize_selected_modules(selected_modules)
    return validate_iac_structure(root, selected_modules=modules)


def _build_local_project_tools(settings: Settings, project_id: str) -> list[Any]:
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

    @tool("validate_iac_structure")
    async def validate_iac_structure_tool(selected_modules: list[str] | None = None) -> dict:
        """Validate Terraform + Ansible file structure against required template contract."""
        return await _iac_structure_tool_validate(project_id, selected_modules)

    return [
        opentofu_preview_deploy,
        opentofu_apply_deploy,
        ansible_run_config,
        validate_iac_structure_tool,
    ]


async def _load_opentofu_mcp_tools(settings: Settings) -> tuple[list[Any], bool]:
    try:
        from langchain_mcp_adapters.client import MultiServerMCPClient

        client = MultiServerMCPClient(
            {
                "opentofu": {
                    "transport": "sse",
                    "url": settings.opentofu_mcp_url,
                }
            }
        )
        return list(await client.get_tools()), True
    except Exception:
        logger.warning(
            "OpenTofu MCP unavailable; continuing with local tools only (url=%s)",
            settings.opentofu_mcp_url,
            exc_info=True,
        )
        return [], False


async def build_project_tools(settings: Settings, project_id: str) -> tuple[list[Any], bool]:
    local_tools = _build_local_project_tools(settings, project_id)
    if not settings.opentofu_mcp_enabled:
        return local_tools, True
    mcp_tools, mcp_ready = await _load_opentofu_mcp_tools(settings)
    return [*local_tools, *mcp_tools], mcp_ready
