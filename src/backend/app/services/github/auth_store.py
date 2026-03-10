from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models import GitHubAccount, GitHubSession

from .auth_common import GitHubAuthError
from .auth_crypto import (
    decrypt_token,
    encrypt_token,
    ensure_oauth_config,
    token_expiry_from_payload,
    token_refresh_is_due,
)
from .auth_oauth import refresh_access_token


async def upsert_account_from_oauth(
    session: AsyncSession,
    *,
    settings: Settings,
    user: dict[str, Any],
    token_payload: dict[str, Any],
) -> GitHubAccount:
    github_user_id = str(user.get("id", ""))
    login = str(user.get("login", ""))
    if not github_user_id or not login:
        raise GitHubAuthError("Invalid GitHub user payload")

    result = await session.execute(
        select(GitHubAccount).where(GitHubAccount.github_user_id == github_user_id)
    )
    account = result.scalar_one_or_none()
    if account is None:
        account = GitHubAccount(
            id=str(uuid.uuid4()),
            github_user_id=github_user_id,
            login=login,
            access_token_encrypted=encrypt_token(settings, str(token_payload.get("access_token")) or "") or "",
            refresh_token_encrypted=encrypt_token(settings, token_payload.get("refresh_token")),
            expires_at=token_expiry_from_payload(token_payload),
            scope=str(token_payload.get("scope", "")),
            updated_at=datetime.now(timezone.utc),
        )
        session.add(account)
    else:
        account.login = login
        account.access_token_encrypted = (
            encrypt_token(settings, str(token_payload.get("access_token")) or "") or ""
        )
        account.refresh_token_encrypted = encrypt_token(settings, token_payload.get("refresh_token"))
        account.expires_at = token_expiry_from_payload(token_payload)
        account.scope = str(token_payload.get("scope", ""))
        account.updated_at = datetime.now(timezone.utc)
    return account


async def create_session_for_account(
    session: AsyncSession,
    *,
    settings: Settings,
    github_account_id: str,
) -> GitHubSession:
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=max(1, settings.github_session_ttl_hours))
    gh_session = GitHubSession(
        id=secrets.token_urlsafe(32),
        github_account_id=github_account_id,
        expires_at=expires_at,
    )
    session.add(gh_session)
    return gh_session


async def get_valid_session_account(
    session: AsyncSession,
    *,
    session_id: str | None,
) -> tuple[GitHubSession | None, GitHubAccount | None]:
    if not session_id:
        return None, None
    now = datetime.now(timezone.utc)
    result = await session.execute(
        select(GitHubSession).where(GitHubSession.id == session_id)
    )
    gh_session = result.scalar_one_or_none()
    if gh_session is None or gh_session.expires_at <= now:
        if gh_session is not None:
            await session.delete(gh_session)
        return None, None
    account = await session.get(GitHubAccount, gh_session.github_account_id)
    if account is None:
        return None, None
    return gh_session, account


async def delete_session(session: AsyncSession, *, session_id: str | None) -> None:
    if not session_id:
        return
    await session.execute(delete(GitHubSession).where(GitHubSession.id == session_id))


async def has_active_session_for_account(session: AsyncSession, github_account_id: str) -> bool:
    now = datetime.now(timezone.utc)
    result = await session.execute(
        select(GitHubSession.id).where(
            GitHubSession.github_account_id == github_account_id,
            GitHubSession.expires_at > now,
        )
    )
    return result.first() is not None


async def get_account_access_token(
    session: AsyncSession,
    *,
    settings: Settings,
    account: GitHubAccount,
) -> str:
    ensure_oauth_config(settings)
    now = datetime.now(timezone.utc)
    if token_refresh_is_due(account.expires_at):
        refresh_token = decrypt_token(settings, account.refresh_token_encrypted)
        if refresh_token:
            refreshed = await refresh_access_token(settings, refresh_token)
            account.access_token_encrypted = (
                encrypt_token(settings, str(refreshed.get("access_token")) or "") or ""
            )
            account.refresh_token_encrypted = (
                encrypt_token(settings, refreshed.get("refresh_token"))
                if refreshed.get("refresh_token")
                else account.refresh_token_encrypted
            )
            account.expires_at = token_expiry_from_payload(refreshed)
            account.scope = str(refreshed.get("scope", account.scope or ""))
            account.updated_at = now
            await session.flush()

    token = decrypt_token(settings, account.access_token_encrypted)
    if not token:
        raise GitHubAuthError("GitHub access token missing")
    return token
