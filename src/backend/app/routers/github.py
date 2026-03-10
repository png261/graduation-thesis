"""GitHub OAuth/session endpoints."""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import AuthIdentity, User
from app.routers import auth_dependencies as auth_deps
from app.models import GitHubAccount
from app.routers import github_dependencies as github_deps
from app.routers import github_helpers
from app.services.auth import service as auth_service
from app.services.github import auth as github_auth
from app.services.github.repo_payloads import repo_payload

router = APIRouter(prefix="/api/github", tags=["github"])


@router.get("/login")
async def github_login(
    _: User = Depends(auth_deps.require_current_user),
) -> RedirectResponse:
    settings = get_settings()
    try:
        state = secrets.token_urlsafe(24)
        url = github_auth.build_login_url(settings, state)
    except github_auth.GitHubAuthError as exc:
        raise github_deps.to_github_auth_http_exception(
            exc,
            status_code=500,
            code="github_oauth_config_error",
        )
    response = RedirectResponse(url=url, status_code=302)
    response.set_cookie(
        github_auth.OAUTH_STATE_COOKIE,
        state,
        max_age=600,
        **github_helpers.cookie_kwargs(),
    )
    return response


@router.get("/callback")
async def github_callback(
    request: Request,
    session: AsyncSession = Depends(github_deps.get_db_session),
    current_user: User = Depends(auth_deps.require_current_user),
    code: str | None = None,
    state: str | None = None,
) -> RedirectResponse:
    settings = get_settings()
    expected_state = request.cookies.get(github_auth.OAUTH_STATE_COOKIE)
    if not code or not state or not expected_state or state != expected_state:
        github_deps.raise_http_error(
            400,
            code="invalid_oauth_callback_state",
            message="Invalid OAuth callback state",
        )

    try:
        token_payload = await github_auth.exchange_code_for_token(settings, code)
        user = await github_auth.github_get_user(str(token_payload["access_token"]))
        account = await github_auth.upsert_account_from_oauth(
            session,
            settings=settings,
            user=user,
            token_payload=token_payload,
        )
        identity_result = await session.execute(
            select(AuthIdentity).where(
                AuthIdentity.provider == "github",
                AuthIdentity.provider_user_id == str(user.get("id") or ""),
            )
        )
        identity = identity_result.scalar_one_or_none()
        now = datetime.now(timezone.utc)
        if identity is None:
            identity = AuthIdentity(
                id=str(uuid.uuid4()),
                user_id=current_user.id,
                provider="github",
                provider_user_id=str(user.get("id") or ""),
                email=str(user.get("email") or "") or None,
                email_verified=bool(user.get("email")),
                login=str(user.get("login") or "") or None,
                access_token_encrypted=auth_service.encrypt_token(
                    settings,
                    str(token_payload.get("access_token") or ""),
                ),
                refresh_token_encrypted=auth_service.encrypt_token(
                    settings,
                    token_payload.get("refresh_token"),
                ),
                expires_at=github_auth.token_expiry_from_payload(token_payload),
                scope=str(token_payload.get("scope") or ""),
                github_account_id=account.id,
                updated_at=now,
            )
            session.add(identity)
        else:
            identity.user_id = current_user.id
            identity.login = str(user.get("login") or "") or identity.login
            identity.email = str(user.get("email") or "") or identity.email
            identity.email_verified = bool(user.get("email"))
            identity.access_token_encrypted = auth_service.encrypt_token(
                settings,
                str(token_payload.get("access_token") or ""),
            )
            identity.refresh_token_encrypted = auth_service.encrypt_token(
                settings,
                token_payload.get("refresh_token"),
            )
            identity.expires_at = github_auth.token_expiry_from_payload(token_payload)
            identity.scope = str(token_payload.get("scope") or "")
            identity.github_account_id = account.id
            identity.updated_at = now

        gh_session = await github_auth.create_session_for_account(
            session,
            settings=settings,
            github_account_id=account.id,
        )
    except github_auth.GitHubAuthError as exc:
        params = urlencode({"github_error": str(exc)})
        return RedirectResponse(
            url=f"{settings.github_oauth_success_redirect}?{params}",
            status_code=302,
        )

    response = RedirectResponse(url=settings.github_oauth_success_redirect, status_code=302)
    response.delete_cookie(github_auth.OAUTH_STATE_COOKIE, path="/")
    response.set_cookie(
        github_auth.SESSION_COOKIE,
        gh_session.id,
        max_age=settings.github_session_ttl_hours * 3600,
        **github_helpers.cookie_kwargs(),
    )
    return response


class LogoutResponse(BaseModel):
    ok: bool


class CreateRepoBody(BaseModel):
    name: str
    description: str = ""
    private: bool = True


@router.post("/logout", response_model=LogoutResponse)
async def github_logout(
    response: Response,
    session: AsyncSession = Depends(github_deps.get_db_session),
    _: User = Depends(auth_deps.require_current_user),
    session_ctx: github_deps.GitHubSessionContext = Depends(
        github_deps.get_github_session_context
    ),
) -> LogoutResponse:
    await github_auth.delete_session(session, session_id=session_ctx.session_id)
    response.delete_cookie(github_auth.SESSION_COOKIE, path="/")
    response.delete_cookie(github_auth.OAUTH_STATE_COOKIE, path="/")
    return LogoutResponse(ok=True)


@router.get("/session")
async def github_session_status(
    current_user: User | None = Depends(auth_deps.get_current_user_optional),
    session_ctx: github_deps.GitHubSessionContext = Depends(
        github_deps.get_github_session_context
    ),
) -> dict:
    if current_user is None:
        return {"authenticated": False}
    if session_ctx.account is None:
        return {"authenticated": False}
    return {
        "authenticated": True,
        "login": session_ctx.account.login,
        "githubUserId": session_ctx.account.github_user_id,
        "githubAccountId": session_ctx.account.id,
        "expiresAt": (
            session_ctx.github_session.expires_at.isoformat()
            if session_ctx.github_session
            else None
        ),
    }


@router.get("/repos")
async def github_repos(
    session: AsyncSession = Depends(github_deps.get_db_session),
    account: GitHubAccount = Depends(github_deps.require_authenticated_github_account),
) -> dict:
    settings = get_settings()
    token = await github_helpers.account_access_token_or_http_error(session, settings, account)
    try:
        repos = await github_auth.github_list_repos(token)
    except github_auth.GitHubAuthError as exc:
        raise github_helpers.map_auth_error(exc, code="github_list_repos_failed")

    result = [repo_payload(repo) for repo in repos]
    result.sort(key=lambda item: str(item.get("full_name", "")))
    return {"repos": result}


@router.post("/repos")
async def github_create_repo(
    body: CreateRepoBody,
    session: AsyncSession = Depends(github_deps.get_db_session),
    account: GitHubAccount = Depends(github_deps.require_authenticated_github_account),
) -> dict:
    settings = get_settings()
    token = await github_helpers.account_access_token_or_http_error(session, settings, account)

    try:
        repo = await github_auth.github_create_repo(
            token,
            name=body.name,
            description=body.description,
            private=body.private,
        )
    except github_auth.GitHubAuthError as exc:
        raise github_helpers.map_auth_error(exc, code="github_create_repo_failed")

    return {"repo": repo_payload(repo)}
