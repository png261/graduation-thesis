"""GitHub OAuth/session endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from app.core.config import get_settings
from app.models import User
from app.routers import auth_dependencies as auth_deps
from app.routers import github_dependencies as github_deps
from app.services.github import auth as github_auth
from app.services.github import oauth as github_oauth
from app.services.github.repo_payloads import repo_payload

router = APIRouter(prefix="/api/github", tags=["github"])


class CreateRepoBody(BaseModel):
    name: str
    description: str = ""
    private: bool = True


def _popup_html(*, ok: bool, message: str) -> str:
    status = "ok" if ok else "error"
    safe_message = message.replace("'", "\\'")
    return (
        "<html><body><script>"
        f"if(window.opener){{window.opener.postMessage({{source:'github-oauth',status:'{status}',message:'{safe_message}'}}, '*');}}"
        "window.close();"
        "</script></body></html>"
    )


@router.get("/oauth/start")
async def github_oauth_start(user: User = Depends(auth_deps.require_current_user)) -> dict:
    settings = get_settings()
    try:
        authorize_url = github_oauth.build_authorize_url(user_id=user.id, settings=settings)
    except ValueError as exc:
        github_deps.raise_http_error(500, code=str(exc), message=str(exc))
    return {"authorize_url": authorize_url}


@router.get("/oauth/callback")
async def github_oauth_callback(
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    error_description: str | None = Query(default=None),
) -> HTMLResponse:
    settings = get_settings()
    if error:
        return HTMLResponse(_popup_html(ok=False, message=error_description or error), status_code=200)
    if not code or not state:
        return HTMLResponse(_popup_html(ok=False, message="missing_code_or_state"), status_code=200)
    try:
        user_id = github_oauth.parse_oauth_state(state=state, settings=settings)
        token_payload = await github_oauth.exchange_code(code=code, settings=settings)
        access_token = str(token_payload.get("access_token") or "")
        user_payload = await github_oauth.fetch_github_user(access_token)
        await github_oauth.save_user_token(
            user_id=user_id,
            token_payload=token_payload,
            user_payload=user_payload,
            settings=settings,
        )
        return HTMLResponse(_popup_html(ok=True, message="connected"), status_code=200)
    except Exception as exc:
        return HTMLResponse(_popup_html(ok=False, message=str(exc)), status_code=200)


@router.get("/session")
async def github_session_status(
    current_user: User | None = Depends(auth_deps.get_current_user_optional),
    github_ctx: github_deps.GitHubAuthContext | None = Depends(github_deps.get_optional_github_auth_context),
) -> dict:
    if current_user is None or github_ctx is None:
        return {"authenticated": False}
    return {
        "authenticated": True,
        "login": github_ctx.login,
        "githubUserId": github_ctx.github_user_id,
        "githubAccountId": None,
        "expiresAt": None,
    }


@router.get("/repos")
async def github_repos(
    github_ctx: github_deps.GitHubAuthContext = Depends(github_deps.require_authenticated_github_context),
) -> dict:
    try:
        repos = await github_auth.github_list_repos(github_ctx.access_token)
    except github_auth.GitHubAuthError as exc:
        raise github_deps.to_github_auth_http_exception(
            exc,
            status_code=401,
            code="github_list_repos_failed",
        )

    result = [repo_payload(repo) for repo in repos]
    result.sort(key=lambda item: str(item.get("full_name", "")))
    return {"repos": result}


@router.post("/repos")
async def github_create_repo(
    body: CreateRepoBody,
    github_ctx: github_deps.GitHubAuthContext = Depends(github_deps.require_authenticated_github_context),
) -> dict:
    try:
        repo = await github_auth.github_create_repo(
            github_ctx.access_token,
            name=body.name,
            description=body.description,
            private=body.private,
        )
    except github_auth.GitHubAuthError as exc:
        raise github_deps.to_github_auth_http_exception(
            exc,
            status_code=401,
            code="github_create_repo_failed",
        )

    return {"repo": repo_payload(repo)}
