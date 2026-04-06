from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings

from . import persistence as scm_persistence
from .backend import github_app, github_auth, github_projects, repo_payload

GitHubAuthError = github_auth.GitHubAuthError
GitHubProjectError = github_projects.GitHubProjectError


def connection_payload(project: scm_persistence.Project) -> dict[str, Any]:
    return github_projects.connection_payload(project)


def project_auth_mode(project: scm_persistence.Project) -> str:
    return github_app.project_auth_mode(project)


def project_has_installation(project: scm_persistence.Project) -> bool:
    return github_app.project_has_installation(project)


def build_install_url(
    settings: Settings,
    *,
    project_id: str,
    user_id: str,
    origin: str,
) -> str:
    return github_app.build_install_url(
        settings,
        project_id=project_id,
        user_id=user_id,
        origin=origin,
    )


async def complete_installation_callback(
    session: AsyncSession,
    *,
    settings: Settings,
    project_id: str,
    installation_id: str,
    state: str,
) -> tuple[str, Any]:
    return await github_app.complete_installation_callback(
        session,
        settings=settings,
        project_id=project_id,
        installation_id=installation_id,
        state=state,
    )


async def list_installation_repositories(settings: Settings, installation_id: str) -> list[dict[str, Any]]:
    repos = await github_app.list_installation_repositories(settings, installation_id)
    result = [repo_payload(repo) for repo in repos]
    result.sort(key=lambda item: str(item.get("full_name", "")))
    return result


async def connect_project_repository(
    session: AsyncSession,
    *,
    project: scm_persistence.Project,
    access_token: str,
    repo_full_name: str,
    base_branch: str | None,
    confirm_workspace_switch: bool,
) -> dict[str, Any]:
    return await github_projects.connect_project_repository(
        session,
        project=project,
        access_token=access_token,
        repo_full_name=repo_full_name,
        base_branch=base_branch,
        confirm_workspace_switch=confirm_workspace_switch,
    )


async def sync_project_repository(
    session: AsyncSession,
    *,
    project: scm_persistence.Project,
    access_token: str,
    confirm_workspace_switch: bool,
) -> dict[str, Any]:
    return await github_projects.sync_project_repository(
        session,
        project=project,
        access_token=access_token,
        confirm_workspace_switch=confirm_workspace_switch,
    )


async def disconnect_project_repository(
    session: AsyncSession,
    *,
    project: scm_persistence.Project,
) -> dict[str, Any]:
    return await github_projects.disconnect_project_repository(session, project=project)


async def build_project_pull_request_defaults(
    session: AsyncSession,
    project: scm_persistence.Project,
) -> dict[str, Any]:
    return await github_projects.build_project_pull_request_defaults(session, project)


async def create_project_pull_request(
    session: AsyncSession,
    *,
    project: scm_persistence.Project,
    access_token: str,
    github_login: str | None,
    title: str,
    body: str,
    base_branch: str | None,
) -> dict[str, Any]:
    return await github_projects.create_project_pull_request(
        session,
        project=project,
        access_token=access_token,
        github_login=github_login,
        title=title,
        body=body,
        base_branch=base_branch,
    )
