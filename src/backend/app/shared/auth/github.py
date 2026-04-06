"""Shared dependencies and error mapping for GitHub-backed routes."""

from __future__ import annotations

from dataclasses import dataclass
from typing import AsyncGenerator

from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.shared.auth import dependencies as auth_deps
from app.shared.auth.backend import github_app, github_auth, github_projects
from app.shared.http.errors import error_detail, raise_http_error
from app.shared.identity import persistence as identity_project_persistence


def to_github_auth_http_exception(
    exc: github_auth.GitHubAuthError,
    *,
    status_code: int = 400,
    code: str = "github_auth_error",
) -> HTTPException:
    return HTTPException(status_code=status_code, detail=error_detail(code, str(exc)))


def raise_github_project_http_error(exc: github_projects.GitHubProjectError) -> None:
    raise HTTPException(
        status_code=exc.status_code,
        detail=error_detail(exc.code, exc.message),
    )


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    async with identity_project_persistence.get_session() as session:
        yield session


async def get_project_or_404(
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> identity_project_persistence.Project:
    return project


@dataclass(slots=True)
class ProjectGitHubStatusContext:
    project: identity_project_persistence.Project
    app_installed: bool


async def get_project_github_status_context(
    project: identity_project_persistence.Project = Depends(get_project_or_404),
) -> ProjectGitHubStatusContext:
    return ProjectGitHubStatusContext(
        project=project,
        app_installed=github_app.project_has_installation(project),
    )


@dataclass(slots=True)
class ProjectGitHubExecutionContext:
    project: identity_project_persistence.Project
    auth_mode: str
    access_token: str
    login: str
    installation_id: str | None


def _installation_login(project: identity_project_persistence.Project) -> str:
    return str(project.github_installation_account_login or project.github_repository_owner or "deepagents-app")


async def require_project_github_execution_context(
    project: identity_project_persistence.Project = Depends(get_project_or_404),
) -> ProjectGitHubExecutionContext:
    if github_app.project_has_installation(project):
        settings = get_settings()
        installation_id = str(project.github_installation_id or "")
        token = await github_app.mint_installation_token(settings, installation_id)
        return ProjectGitHubExecutionContext(
            project=project,
            auth_mode="app_installation",
            access_token=token.token,
            login=_installation_login(project),
            installation_id=installation_id,
        )
    raise_http_error(
        401,
        code="github_app_install_required",
        message="GitHub App installation required",
    )


async def require_project_with_connected_execution_context(
    context: ProjectGitHubExecutionContext = Depends(require_project_github_execution_context),
) -> ProjectGitHubExecutionContext:
    if not context.project.github_repo_full_name:
        raise_http_error(
            400,
            code="project_not_connected",
            message="Project is not connected to GitHub",
        )
    return context
