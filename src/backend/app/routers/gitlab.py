"""GitLab OAuth/session endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse

from app.core.config import get_settings
from app.models import User
from app.routers import auth_dependencies as auth_deps
from app.routers.http_errors import raise_http_error
from app.services.state_backends import gitlab_auth

router = APIRouter(prefix="/api/gitlab", tags=["gitlab"])


def _popup_html(*, ok: bool, message: str) -> str:
    status = "ok" if ok else "error"
    safe_message = message.replace("'", "\\'")
    return (
        "<html><body><script>"
        f"if(window.opener){{window.opener.postMessage({{source:'gitlab-oauth',status:'{status}',message:'{safe_message}'}}, '*');}}"
        "window.close();"
        "</script></body></html>"
    )


@router.get("/session")
async def gitlab_session(user: User = Depends(auth_deps.require_current_user)) -> dict:
    return await gitlab_auth.get_user_session(user_id=user.id, settings=get_settings())


@router.get("/repos")
async def gitlab_repos(user: User = Depends(auth_deps.require_current_user)) -> dict:
    settings = get_settings()
    access_token = await gitlab_auth.get_user_access_token(user_id=user.id, settings=settings)
    if not access_token:
        raise_http_error(401, code="gitlab_login_required", message="GitLab login required")
    try:
        repos = await gitlab_auth.list_repositories(access_token=access_token, settings=settings)
    except Exception as exc:
        raise_http_error(400, code="gitlab_list_repos_failed", message=str(exc))
    return {"repos": repos}


@router.get("/oauth/start")
async def gitlab_oauth_start(user: User = Depends(auth_deps.require_current_user)) -> dict:
    settings = get_settings()
    try:
        authorize_url = gitlab_auth.build_authorize_url(user_id=user.id, settings=settings)
    except ValueError as exc:
        raise_http_error(500, code=str(exc), message=str(exc))
    return {"authorize_url": authorize_url}


@router.get("/oauth/callback")
async def gitlab_oauth_callback(
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
        user_id = gitlab_auth.parse_oauth_state(state=state, settings=settings)
        token_payload = await gitlab_auth.exchange_code(code=code, settings=settings)
        access_token = str(token_payload.get("access_token") or "")
        user_payload = await gitlab_auth.fetch_gitlab_user(access_token, settings)
        await gitlab_auth.save_user_token(
            user_id=user_id,
            token_payload=token_payload,
            user_payload=user_payload,
            settings=settings,
        )
        return HTMLResponse(_popup_html(ok=True, message="connected"), status_code=200)
    except Exception as exc:
        return HTMLResponse(_popup_html(ok=False, message=str(exc)), status_code=200)
