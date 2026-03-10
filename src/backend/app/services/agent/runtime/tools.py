"""Project-scoped tools exposed to the deep agent."""
from __future__ import annotations

from typing import Any

from langchain.tools import tool
from sqlalchemy import select

from app import db
from app.core.config import Settings
from app.models import GitHubAccount, Project
from app.services.github import auth as github_auth
from app.services.github import projects as github_projects
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
    )
    return {"status": "ok" if result["final"]["status"] == "ok" else "failed", **result}


async def _github_tool_create_pull_request(
    project_id: str,
    settings: Settings,
    title: str,
    body: str = "",
    base_branch: str | None = None,
) -> dict:
    async with db.get_session() as session:
        result = await session.execute(select(Project).where(Project.id == project_id))
        project = result.scalar_one_or_none()
        if project is None:
            return {"status": "error", "code": "project_not_found", "message": "Project not found"}
        if not project.github_account_id:
            return {
                "status": "error",
                "code": "project_not_connected",
                "message": "Project is not connected to GitHub",
            }

        account = await session.get(GitHubAccount, project.github_account_id)
        if account is None:
            return {
                "status": "error",
                "code": "github_account_not_found",
                "message": "Connected GitHub account is no longer available",
            }

        try:
            result = await github_projects.create_project_pull_request(
                session,
                settings=settings,
                project=project,
                account=account,
                title=title,
                body=body,
                base_branch=base_branch,
            )
            return {"status": "ok", **result}
        except github_projects.GitHubProjectError as exc:
            return {"status": "error", "code": exc.code, "message": exc.message}
        except github_auth.GitHubAuthError as exc:
            return {"status": "error", "code": "github_auth_error", "message": str(exc)}


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
    ) -> dict:
        """Apply selected OpenTofu modules after explicit confirmation."""
        return await _opentofu_tool_apply(
            project_id=project_id,
            settings=settings,
            selected_modules=selected_modules,
            confirm=confirm,
            intent=intent or None,
        )

    @tool("github_create_pull_request")
    async def github_create_pull_request(
        title: str,
        body: str = "",
        base_branch: str = "",
    ) -> dict:
        """Create a pull request for this project after committing and pushing local changes."""
        return await _github_tool_create_pull_request(
            project_id=project_id,
            settings=settings,
            title=title,
            body=body,
            base_branch=base_branch or None,
        )

    return [
        opentofu_preview_deploy,
        opentofu_apply_deploy,
        github_create_pull_request,
    ]
