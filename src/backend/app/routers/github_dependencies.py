"""Shared FastAPI dependencies and error mapping for GitHub-backed routes."""
from __future__ import annotations

from dataclasses import dataclass
from typing import AsyncGenerator

from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app import db
from app.core.config import get_settings
from app.models import Project, User
from app.routers import auth_dependencies as auth_deps
from app.routers.http_errors import error_detail, raise_http_error
import app.services.clerk as clerk_service
from app.services.github import auth as github_auth
from app.services.github import projects as github_projects


def to_github_auth_http_exception(
    exc: github_auth.GitHubAuthError,
    *,
    status_code: int = 400,
    code: str = "github_auth_error",
) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail=error_detail(code, str(exc)),
    )


def raise_github_project_http_error(exc: github_projects.GitHubProjectError) -> None:
    raise HTTPException(
        status_code=exc.status_code,
        detail=error_detail(exc.code, exc.message),
    )


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    async with db.get_session() as session:
        yield session


@dataclass(slots=True)
class GitHubAuthContext:
    user: User
    access_token: str
    login: str
    github_user_id: str
    scopes: list[str]


async def get_optional_github_auth_context(
    user: User = Depends(auth_deps.require_current_user),
) -> GitHubAuthContext | None:
    settings = get_settings()
    try:
        oauth = clerk_service.get_github_oauth_token(settings=settings, user_id=user.id)
    except clerk_service.ClerkError as exc:
        raise_http_error(500, code="auth_config_error", message=str(exc))
    except Exception:
        return None

    if oauth is None:
        return None

    try:
        gh_user = await github_auth.github_get_user(oauth.token)
    except github_auth.GitHubAuthError:
        return None

    return GitHubAuthContext(
        user=user,
        access_token=oauth.token,
        login=str(gh_user.get("login") or ""),
        github_user_id=str(gh_user.get("id") or oauth.provider_user_id or ""),
        scopes=oauth.scopes,
    )


async def require_authenticated_github_context(
    ctx: GitHubAuthContext | None = Depends(get_optional_github_auth_context),
) -> GitHubAuthContext:
    if ctx is None:
        raise_http_error(
            401,
            code="github_login_required",
            message="GitHub login required",
        )
    return ctx


async def get_project_or_404(
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> Project:
    return project


@dataclass(slots=True)
class ProjectGitHubStatusContext:
    project: Project
    github_auth: GitHubAuthContext | None


async def get_project_github_status_context(
    project: Project = Depends(get_project_or_404),
    github_auth: GitHubAuthContext | None = Depends(get_optional_github_auth_context),
) -> ProjectGitHubStatusContext:
    return ProjectGitHubStatusContext(
        project=project,
        github_auth=github_auth,
    )


@dataclass(slots=True)
class ProjectAccountContext:
    project: Project
    github_auth: GitHubAuthContext


async def require_project_and_authenticated_account(
    project: Project = Depends(get_project_or_404),
    github_auth: GitHubAuthContext = Depends(require_authenticated_github_context),
) -> ProjectAccountContext:
    return ProjectAccountContext(project=project, github_auth=github_auth)


async def require_project_with_connected_account(
    project: Project = Depends(get_project_or_404),
    github_auth: GitHubAuthContext = Depends(require_authenticated_github_context),
) -> ProjectAccountContext:
    if not project.github_repo_full_name:
        raise_http_error(
            400,
            code="project_not_connected",
            message="Project is not connected to GitHub",
        )
    return ProjectAccountContext(project=project, github_auth=github_auth)


@dataclass(slots=True)
class ProjectDisconnectContext:
    project: Project
    github_auth: GitHubAuthContext | None


async def get_project_disconnect_context(
    project: Project = Depends(get_project_or_404),
    github_auth: GitHubAuthContext | None = Depends(get_optional_github_auth_context),
) -> ProjectDisconnectContext:
    return ProjectDisconnectContext(
        project=project,
        github_auth=github_auth,
    )

