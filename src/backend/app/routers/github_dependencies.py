"""Shared FastAPI dependencies and error mapping for GitHub-backed routes."""
from __future__ import annotations

from dataclasses import dataclass
from typing import AsyncGenerator

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import db
from app.models import AuthIdentity, GitHubAccount, GitHubSession, Project, User
from app.routers import auth_dependencies as auth_deps
from app.routers.http_errors import error_detail, raise_http_error
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


def get_github_session_id(request: Request) -> str | None:
    # Keep session-cookie access centralized in one dependency.
    return request.cookies.get(github_auth.SESSION_COOKIE)


@dataclass(slots=True)
class GitHubSessionContext:
    session_id: str | None
    github_session: GitHubSession | None
    account: GitHubAccount | None


async def get_github_session_context(
    session: AsyncSession = Depends(get_db_session),
    session_id: str | None = Depends(get_github_session_id),
) -> GitHubSessionContext:
    gh_session, account = await github_auth.get_valid_session_account(
        session,
        session_id=session_id,
    )
    return GitHubSessionContext(
        session_id=session_id,
        github_session=gh_session,
        account=account,
    )


async def require_authenticated_github_account(
    current_user: User = Depends(auth_deps.require_current_user),
    session: AsyncSession = Depends(get_db_session),
    session_ctx: GitHubSessionContext = Depends(get_github_session_context),
) -> GitHubAccount:
    if session_ctx.account is None:
        raise_http_error(
            401,
            code="github_login_required",
            message="GitHub login required",
        )
    identity_result = await session.execute(
        select(AuthIdentity).where(
            AuthIdentity.user_id == current_user.id,
            AuthIdentity.provider == "github",
            AuthIdentity.github_account_id == session_ctx.account.id,
        )
    )
    identity = identity_result.scalar_one_or_none()
    if identity is None:
        raise_http_error(
            401,
            code="github_login_required",
            message="GitHub login required",
        )
    return session_ctx.account


async def get_project_or_404(
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> Project:
    return project


@dataclass(slots=True)
class ProjectGitHubStatusContext:
    project: Project
    session_account: GitHubAccount | None
    connected_account: GitHubAccount | None


async def get_project_github_status_context(
    project: Project = Depends(get_project_or_404),
    session: AsyncSession = Depends(get_db_session),
    session_ctx: GitHubSessionContext = Depends(get_github_session_context),
) -> ProjectGitHubStatusContext:
    connected_account = (
        await session.get(GitHubAccount, project.github_account_id)
        if project.github_account_id
        else None
    )
    return ProjectGitHubStatusContext(
        project=project,
        session_account=session_ctx.account,
        connected_account=connected_account,
    )


@dataclass(slots=True)
class ProjectAccountContext:
    project: Project
    account: GitHubAccount


async def require_project_and_authenticated_account(
    project: Project = Depends(get_project_or_404),
    account: GitHubAccount = Depends(require_authenticated_github_account),
) -> ProjectAccountContext:
    return ProjectAccountContext(project=project, account=account)


async def require_project_with_connected_account(
    project: Project = Depends(get_project_or_404),
    session: AsyncSession = Depends(get_db_session),
) -> ProjectAccountContext:
    if not project.github_account_id:
        raise_http_error(
            400,
            code="project_not_connected",
            message="Project is not connected to GitHub",
        )
    account = await session.get(GitHubAccount, project.github_account_id)
    if account is None:
        raise_http_error(
            404,
            code="connected_account_not_found",
            message="Connected GitHub account not found",
        )
    return ProjectAccountContext(project=project, account=account)


@dataclass(slots=True)
class ProjectDisconnectContext:
    project: Project
    session_account: GitHubAccount | None


async def get_project_disconnect_context(
    project: Project = Depends(get_project_or_404),
    session_ctx: GitHubSessionContext = Depends(get_github_session_context),
) -> ProjectDisconnectContext:
    return ProjectDisconnectContext(
        project=project,
        session_account=session_ctx.account,
    )
