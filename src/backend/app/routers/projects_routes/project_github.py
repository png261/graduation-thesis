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
from app.services.telegram import notifications as telegram_notifications

router = APIRouter()


class GitHubConnectBody(BaseModel):
    repo_full_name: str
    base_branch: str | None = None
    confirm_workspace_switch: bool = False


class GitHubSyncBody(BaseModel):
    confirm_workspace_switch: bool = False


class GitHubPullRequestBody(BaseModel):
    title: str
    description: str = ""
    base_branch: str | None = None


def _connect_response(payload: dict, login: str) -> dict:
    return {
        "ok": True,
        **payload,
        "session_authenticated": True,
        "session_login": login,
        "connected_account_login": login,
        "session_account_matches": True,
    }


def _raise_route_auth_error(exc: github_auth.GitHubAuthError, *, code: str) -> None:
    raise github_deps.to_github_auth_http_exception(
        exc,
        status_code=400,
        code=code,
    )


@router.get("/{project_id}/github")
async def project_github_status(
    context: github_deps.ProjectGitHubStatusContext = Depends(
        github_deps.get_project_github_status_context
    ),
) -> dict:
    payload = github_projects.connection_payload(context.project)
    payload.update(
        {
            "session_authenticated": context.github_auth is not None,
            "session_login": context.github_auth.login if context.github_auth else None,
            "connected_account_login": context.github_auth.login if context.github_auth else None,
            "session_account_matches": bool(context.github_auth and payload.get("connected")),
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
    try:
        payload = await github_projects.connect_project_repository(
            session,
            project=context.project,
            access_token=context.github_auth.access_token,
            repo_full_name=body.repo_full_name,
            base_branch=body.base_branch,
            confirm_workspace_switch=body.confirm_workspace_switch,
        )
    except github_projects.GitHubProjectError as exc:
        github_deps.raise_github_project_http_error(exc)
    except github_auth.GitHubAuthError as exc:
        _raise_route_auth_error(exc, code="github_connect_failed")

    invalidate_agent(project_id)
    return _connect_response(payload, context.github_auth.login)


@router.post("/{project_id}/github/sync")
async def sync_project_github(
    project_id: str,
    body: GitHubSyncBody,
    session: AsyncSession = Depends(github_deps.get_db_session),
    context: github_deps.ProjectAccountContext = Depends(
        github_deps.require_project_with_connected_account
    ),
) -> dict:
    try:
        payload = await github_projects.sync_project_repository(
            session,
            project=context.project,
            access_token=context.github_auth.access_token,
            confirm_workspace_switch=body.confirm_workspace_switch,
        )
    except github_projects.GitHubProjectError as exc:
        github_deps.raise_github_project_http_error(exc)
    except github_auth.GitHubAuthError as exc:
        _raise_route_auth_error(exc, code="github_sync_failed")

    invalidate_agent(project_id)
    return _connect_response(payload, context.github_auth.login)


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
        "session_authenticated": context.github_auth is not None,
        "session_login": context.github_auth.login if context.github_auth else None,
        "connected_account_login": None,
        "session_account_matches": False,
    }


@router.get("/{project_id}/github/pull-request/defaults")
async def project_pull_request_defaults(
    session: AsyncSession = Depends(github_deps.get_db_session),
    context: github_deps.ProjectAccountContext = Depends(
        github_deps.require_project_with_connected_account
    ),
) -> dict:
    try:
        return await github_projects.build_project_pull_request_defaults(
            session,
            context.project,
        )
    except github_projects.GitHubProjectError as exc:
        github_deps.raise_github_project_http_error(exc)


@router.post("/{project_id}/github/pull-request")
async def create_project_pull_request(
    project_id: str,
    body: GitHubPullRequestBody,
    session: AsyncSession = Depends(github_deps.get_db_session),
    context: github_deps.ProjectAccountContext = Depends(
        github_deps.require_project_with_connected_account
    ),
) -> dict:
    try:
        result = await github_projects.create_project_pull_request(
            session,
            project=context.project,
            access_token=context.github_auth.access_token,
            github_login=context.github_auth.login,
            title=body.title,
            body=body.description,
            base_branch=body.base_branch,
        )
        await telegram_notifications.notify_project(
            context.project,
            get_settings(),
            telegram_notifications.github_pull_request_text(context.project, result),
        )
        return result
    except github_projects.GitHubProjectError as exc:
        github_deps.raise_github_project_http_error(exc)
    except github_auth.GitHubAuthError as exc:
        _raise_route_auth_error(exc, code="github_pull_request_failed")
