from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.auth import dependencies as auth_deps
from app.shared.auth import github as github_deps

from .runtime import identity_project_persistence, identity_project_service, scm_service, settings

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


def _default_origin(request: Request | None, fallback: list[str]) -> str:
    if request is not None:
        origin = request.headers.get("origin")
        if origin:
            return origin
    if fallback:
        return fallback[0]
    if request is not None:
        return str(request.base_url).rstrip("/")
    return "*"


def _app_popup_response(*, origin: str, status: str, message: str = "") -> HTMLResponse:
    safe_origin = origin.replace("\\", "\\\\").replace('"', '\\"')
    safe_status = status.replace("\\", "\\\\").replace('"', '\\"')
    safe_message = message.replace("\\", "\\\\").replace('"', '\\"')
    html = f"""<!doctype html>
<html>
  <body style="font-family: sans-serif; padding: 24px;">
    <p>{'GitHub App installed. You can close this window.' if status == 'ok' else 'GitHub App install failed.'}</p>
    <script>
      (function() {{
        var payload = {{
          source: "github-app-install",
          status: "{safe_status}",
          message: "{safe_message}"
        }};
        if (window.opener) {{
          window.opener.postMessage(payload, "{safe_origin}");
        }}
        window.close();
      }})();
    </script>
  </body>
</html>"""
    return HTMLResponse(content=html)


def _connect_response(payload: dict, login: str | None) -> dict:
    return {
        "ok": True,
        **payload,
        "session_authenticated": bool(login),
        "session_login": login,
        "connected_account_login": login,
        "session_account_matches": bool(login),
    }


def _raise_route_auth_error(exc: scm_service.GitHubAuthError, *, code: str) -> None:
    raise github_deps.to_github_auth_http_exception(
        exc,
        status_code=400,
        code=code,
    )


@router.get("/api/projects/{project_id}/github")
async def project_github_status(
    context: github_deps.ProjectGitHubStatusContext = Depends(github_deps.get_project_github_status_context),
) -> dict:
    payload = scm_service.connection_payload(context.project)
    payload.update(
        {
            "session_authenticated": context.app_installed,
            "session_login": context.project.github_installation_account_login,
            "connected_account_login": context.project.github_installation_account_login,
            "session_account_matches": bool(context.app_installed and payload.get("connected")),
        }
    )
    return payload


@router.post("/api/projects/{project_id}/github/app/install/start")
async def start_project_github_app_install(
    project_id: str,
    request: Request,
    _project=Depends(auth_deps.get_owned_project_or_404),
    current_user: identity_project_persistence.User = Depends(auth_deps.require_current_user),
) -> dict:
    origin = _default_origin(request, settings.cors_origins_list())
    return {
        "install_url": scm_service.build_install_url(
            settings,
            project_id=project_id,
            user_id=current_user.id,
            origin=origin,
        )
    }


@router.get("/api/projects/{project_id}/github/app/install/callback")
async def project_github_app_install_callback(
    project_id: str,
    installation_id: str = "",
    state: str = "",
    session: AsyncSession = Depends(github_deps.get_db_session),
) -> HTMLResponse:
    origin = _default_origin(None, settings.cors_origins_list())
    try:
        origin, _installation = await scm_service.complete_installation_callback(
            session,
            settings=settings,
            project_id=project_id,
            installation_id=installation_id,
            state=state,
        )
        identity_project_service.invalidate_project_agent(project_id)
        return _app_popup_response(origin=origin, status="ok")
    except scm_service.GitHubAuthError as exc:
        return _app_popup_response(origin=origin, status="error", message=str(exc))


@router.get("/api/projects/{project_id}/github/app/repos")
async def list_project_github_app_repos(
    context: github_deps.ProjectGitHubExecutionContext = Depends(github_deps.require_project_github_execution_context),
) -> dict:
    if context.auth_mode != "app_installation" or not context.installation_id:
        return {"repos": []}
    try:
        repos = await scm_service.list_installation_repositories(
            settings,
            context.installation_id,
        )
    except scm_service.GitHubAuthError as exc:
        raise github_deps.to_github_auth_http_exception(
            exc,
            status_code=401,
            code="github_list_installation_repos_failed",
        )
    return {"repos": repos}


@router.post("/api/projects/{project_id}/github/connect")
async def connect_project_github(
    project_id: str,
    body: GitHubConnectBody,
    session: AsyncSession = Depends(github_deps.get_db_session),
    context: github_deps.ProjectGitHubExecutionContext = Depends(github_deps.require_project_github_execution_context),
) -> dict:
    try:
        payload = await scm_service.connect_project_repository(
            session,
            project=context.project,
            access_token=context.access_token,
            repo_full_name=body.repo_full_name,
            base_branch=body.base_branch,
            confirm_workspace_switch=body.confirm_workspace_switch,
        )
    except scm_service.GitHubProjectError as exc:
        github_deps.raise_github_project_http_error(exc)
    except scm_service.GitHubAuthError as exc:
        _raise_route_auth_error(exc, code="github_connect_failed")

    identity_project_service.invalidate_project_agent(project_id)
    return _connect_response(payload, context.login)


@router.post("/api/projects/{project_id}/github/sync")
async def sync_project_github(
    project_id: str,
    body: GitHubSyncBody,
    session: AsyncSession = Depends(github_deps.get_db_session),
    context: github_deps.ProjectGitHubExecutionContext = Depends(
        github_deps.require_project_with_connected_execution_context
    ),
) -> dict:
    try:
        payload = await scm_service.sync_project_repository(
            session,
            project=context.project,
            access_token=context.access_token,
            confirm_workspace_switch=body.confirm_workspace_switch,
        )
    except scm_service.GitHubProjectError as exc:
        github_deps.raise_github_project_http_error(exc)
    except scm_service.GitHubAuthError as exc:
        _raise_route_auth_error(exc, code="github_sync_failed")

    identity_project_service.invalidate_project_agent(project_id)
    return _connect_response(payload, context.login)


@router.post("/api/projects/{project_id}/github/disconnect")
async def disconnect_project_github(
    project_id: str,
    session: AsyncSession = Depends(github_deps.get_db_session),
    project=Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    payload = await scm_service.disconnect_project_repository(
        session,
        project=project,
    )

    identity_project_service.invalidate_project_agent(project_id)
    return {
        "ok": True,
        **payload,
        "session_authenticated": bool(project.github_installation_id),
        "session_login": project.github_installation_account_login,
        "connected_account_login": None,
        "session_account_matches": False,
    }


@router.get("/api/projects/{project_id}/github/pull-request/defaults")
async def project_pull_request_defaults(
    session: AsyncSession = Depends(github_deps.get_db_session),
    context: github_deps.ProjectGitHubExecutionContext = Depends(
        github_deps.require_project_with_connected_execution_context
    ),
) -> dict:
    try:
        return await scm_service.build_project_pull_request_defaults(
            session,
            context.project,
        )
    except scm_service.GitHubProjectError as exc:
        github_deps.raise_github_project_http_error(exc)


@router.post("/api/projects/{project_id}/github/pull-request")
async def create_project_pull_request(
    project_id: str,
    body: GitHubPullRequestBody,
    session: AsyncSession = Depends(github_deps.get_db_session),
    context: github_deps.ProjectGitHubExecutionContext = Depends(
        github_deps.require_project_with_connected_execution_context
    ),
) -> dict:
    try:
        result = await scm_service.create_project_pull_request(
            session,
            project=context.project,
            access_token=context.access_token,
            github_login=context.login,
            title=body.title,
            body=body.description,
            base_branch=body.base_branch,
        )
        return result
    except scm_service.GitHubProjectError as exc:
        github_deps.raise_github_project_http_error(exc)
    except scm_service.GitHubAuthError as exc:
        _raise_route_auth_error(exc, code="github_pull_request_failed")
