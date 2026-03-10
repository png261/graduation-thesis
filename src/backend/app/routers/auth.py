"""Application authentication routes (Google/GitHub OAuth + app sessions)."""
from __future__ import annotations

import secrets
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app import db
from app.core.config import get_settings
from app.routers import auth_dependencies as auth_deps
from app.services.auth import service as auth_service
from app.services.github import auth as github_auth

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _error_redirect(message: str) -> RedirectResponse:
    settings = get_settings()
    params = urlencode({"auth_error": message})
    return RedirectResponse(
        url=f"{settings.auth_oauth_success_redirect}?{params}",
        status_code=302,
    )


@router.get("/google/login")
async def google_login() -> RedirectResponse:
    settings = get_settings()
    try:
        state = secrets.token_urlsafe(24)
        url = auth_service.build_google_login_url(settings, state)
    except auth_service.AuthError as exc:
        raise HTTPException(status_code=500, detail={"code": "oauth_config_error", "message": str(exc)})

    response = RedirectResponse(url=url, status_code=302)
    response.set_cookie(
        auth_service.OAUTH_STATE_COOKIE,
        state,
        max_age=600,
        **auth_service.cookie_kwargs(),
    )
    return response


@router.get("/google/callback")
async def google_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
) -> RedirectResponse:
    settings = get_settings()
    expected_state = request.cookies.get(auth_service.OAUTH_STATE_COOKIE)
    if not code or not state or not expected_state or state != expected_state:
        raise HTTPException(
            status_code=400,
            detail={"code": "invalid_oauth_callback_state", "message": "Invalid OAuth callback state"},
        )

    try:
        token_payload = await auth_service.exchange_google_code_for_token(settings, code)
        user_payload = await auth_service.google_get_user(str(token_payload["access_token"]))
        async with db.get_session() as session:
            user, _identity, _created, _legacy_assigned = await auth_service.upsert_user_identity(
                session,
                settings=settings,
                provider="google",
                provider_user_id=str(user_payload.get("sub") or ""),
                email=str(user_payload.get("email") or "") or None,
                email_verified=bool(user_payload.get("email_verified")),
                name=str(user_payload.get("name") or "") or None,
                avatar_url=str(user_payload.get("picture") or "") or None,
                token_payload=token_payload,
            )
            app_session = await auth_service.create_user_session(
                session,
                settings=settings,
                user_id=user.id,
            )
    except auth_service.AuthError as exc:
        return _error_redirect(str(exc))

    response = RedirectResponse(url=settings.auth_oauth_success_redirect, status_code=302)
    response.delete_cookie(auth_service.OAUTH_STATE_COOKIE, path="/")
    response.set_cookie(
        auth_service.APP_SESSION_COOKIE,
        app_session.id,
        max_age=settings.auth_session_ttl_hours * 3600,
        **auth_service.cookie_kwargs(),
    )
    return response


@router.get("/github/login")
async def github_login() -> RedirectResponse:
    settings = get_settings()
    try:
        state = secrets.token_urlsafe(24)
        url = auth_service.build_github_login_url(
            settings,
            state,
            redirect_uri=settings.github_auth_oauth_redirect_uri,
        )
    except auth_service.AuthError as exc:
        raise HTTPException(status_code=500, detail={"code": "oauth_config_error", "message": str(exc)})

    response = RedirectResponse(url=url, status_code=302)
    response.set_cookie(
        auth_service.OAUTH_STATE_COOKIE,
        state,
        max_age=600,
        **auth_service.cookie_kwargs(),
    )
    return response


@router.get("/github/callback")
async def github_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
) -> RedirectResponse:
    settings = get_settings()
    expected_state = request.cookies.get(auth_service.OAUTH_STATE_COOKIE)
    if not code or not state or not expected_state or state != expected_state:
        raise HTTPException(
            status_code=400,
            detail={"code": "invalid_oauth_callback_state", "message": "Invalid OAuth callback state"},
        )

    try:
        token_payload = await auth_service.exchange_github_code_for_token(
            settings,
            code=code,
            redirect_uri=settings.github_auth_oauth_redirect_uri,
        )
        gh_user = await github_auth.github_get_user(str(token_payload["access_token"]))

        async with db.get_session() as session:
            # Keep legacy GitHub account/session in sync so existing repo features continue to work.
            legacy_account = await github_auth.upsert_account_from_oauth(
                session,
                settings=settings,
                user=gh_user,
                token_payload=token_payload,
            )
            legacy_session = await github_auth.create_session_for_account(
                session,
                settings=settings,
                github_account_id=legacy_account.id,
            )

            user, _identity, _created, _legacy_assigned = await auth_service.upsert_user_identity(
                session,
                settings=settings,
                provider="github",
                provider_user_id=str(gh_user.get("id") or ""),
                email=str(gh_user.get("email") or "") or None,
                email_verified=bool(gh_user.get("email")),
                name=str(gh_user.get("name") or "") or None,
                avatar_url=str(gh_user.get("avatar_url") or "") or None,
                login=str(gh_user.get("login") or "") or None,
                token_payload=token_payload,
                github_account_id=legacy_account.id,
            )
            app_session = await auth_service.create_user_session(
                session,
                settings=settings,
                user_id=user.id,
            )
    except (auth_service.AuthError, github_auth.GitHubAuthError) as exc:
        return _error_redirect(str(exc))

    response = RedirectResponse(url=settings.auth_oauth_success_redirect, status_code=302)
    response.delete_cookie(auth_service.OAUTH_STATE_COOKIE, path="/")
    response.set_cookie(
        auth_service.APP_SESSION_COOKIE,
        app_session.id,
        max_age=settings.auth_session_ttl_hours * 3600,
        **auth_service.cookie_kwargs(),
    )
    # Auto-connect GitHub identity for repo operations on GitHub-auth login.
    response.set_cookie(
        github_auth.SESSION_COOKIE,
        legacy_session.id,
        max_age=settings.github_session_ttl_hours * 3600,
        **auth_service.cookie_kwargs(),
    )
    return response


@router.get("/session")
async def auth_session_status(
    ctx: auth_deps.CurrentSessionContext = Depends(auth_deps.get_current_session_context),
) -> dict:
    if ctx.user is None:
        return {"authenticated": False}

    async with db.get_session() as session:
        providers = await auth_service.list_user_providers(session, ctx.user.id)
    return {
        "authenticated": True,
        "user": {
            "id": ctx.user.id,
            "name": ctx.user.name,
            "email": ctx.user.email,
            "avatarUrl": ctx.user.avatar_url,
            "providers": providers,
        },
        "expiresAt": ctx.session.expires_at.isoformat() if ctx.session else None,
    }


class LogoutResponse(BaseModel):
    ok: bool


@router.post("/logout", response_model=LogoutResponse)
async def auth_logout(
    response: Response,
    ctx: auth_deps.CurrentSessionContext = Depends(auth_deps.get_current_session_context),
) -> LogoutResponse:
    if ctx.session_id:
        async with db.get_session() as session:
            await auth_service.delete_user_session(session, session_id=ctx.session_id)
    response.delete_cookie(auth_service.APP_SESSION_COOKIE, path="/")
    response.delete_cookie(auth_service.OAUTH_STATE_COOKIE, path="/")
    response.delete_cookie(github_auth.SESSION_COOKIE, path="/")
    response.delete_cookie(github_auth.OAUTH_STATE_COOKIE, path="/")
    return LogoutResponse(ok=True)
