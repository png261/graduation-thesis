"""Project GitHub connect/disconnect/pull-request endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.routers import github_dependencies as github_deps
from app.services.agent import invalidate_agent
from app.services.github import auth as github_auth
from app.services.github import projects as github_projects

router = APIRouter()


class GitHubConnectBody(BaseModel):
    repo_full_name: str
    base_branch: str | None = None


class GitHubPullRequestBody(BaseModel):
    title: str
    description: str = ""
    base_branch: str | None = None


@router.get("/{project_id}/github")
async def project_github_status(
    context: github_deps.ProjectGitHubStatusContext = Depends(
        github_deps.get_project_github_status_context
    ),
) -> dict:
    payload = github_projects.connection_payload(context.project)
    payload.update(
        {
            "session_authenticated": context.session_account is not None,
            "session_login": context.session_account.login if context.session_account else None,
            "connected_account_login": (
                context.connected_account.login if context.connected_account else None
            ),
            "session_account_matches": bool(
                context.session_account
                and context.project.github_account_id
                and context.session_account.id == context.project.github_account_id
            ),
        }
    )
    return payload


@router.post("/{project_id}/github/connect")
async def connect_project_github(
    project_id: str,
    body: GitHubConnectBody,
    session: AsyncSession = Depends(github_deps.get_db_session),
    context: github_deps.ProjectAccountContext = Depends(
        github_deps.require_project_and_authenticated_account
    ),
) -> dict:
    settings = get_settings()
    try:
        payload = await github_projects.connect_project_repository(
            session,
            settings=settings,
            project=context.project,
            account=context.account,
            repo_full_name=body.repo_full_name,
            base_branch=body.base_branch,
        )
    except github_projects.GitHubProjectError as exc:
        github_deps.raise_github_project_http_error(exc)
    except github_auth.GitHubAuthError as exc:
        raise github_deps.to_github_auth_http_exception(
            exc,
            status_code=400,
            code="github_connect_failed",
        )

    invalidate_agent(project_id)
    return {
        "ok": True,
        **payload,
        "session_authenticated": True,
        "session_login": context.account.login,
        "connected_account_login": context.account.login,
        "session_account_matches": True,
    }


@router.post("/{project_id}/github/disconnect")
async def disconnect_project_github(
    project_id: str,
    session: AsyncSession = Depends(github_deps.get_db_session),
    context: github_deps.ProjectDisconnectContext = Depends(
        github_deps.get_project_disconnect_context
    ),
) -> dict:
    payload = await github_projects.disconnect_project_repository(
        session,
        project=context.project,
    )

    invalidate_agent(project_id)
    return {
        "ok": True,
        **payload,
        "session_authenticated": context.session_account is not None,
        "session_login": context.session_account.login if context.session_account else None,
        "connected_account_login": None,
        "session_account_matches": False,
    }


@router.post("/{project_id}/github/pull-request")
async def create_project_pull_request(
    project_id: str,
    body: GitHubPullRequestBody,
    session: AsyncSession = Depends(github_deps.get_db_session),
    context: github_deps.ProjectAccountContext = Depends(
        github_deps.require_project_with_connected_account
    ),
) -> dict:
    settings = get_settings()
    try:
        return await github_projects.create_project_pull_request(
            session,
            settings=settings,
            project=context.project,
            account=context.account,
            title=body.title,
            body=body.description,
            base_branch=body.base_branch,
        )
    except github_projects.GitHubProjectError as exc:
        github_deps.raise_github_project_http_error(exc)
    except github_auth.GitHubAuthError as exc:
        raise github_deps.to_github_auth_http_exception(
            exc,
            status_code=400,
            code="github_pull_request_failed",
        )
