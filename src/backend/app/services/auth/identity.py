from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models import AuthIdentity, GitHubAccount, Project, User

from .shared import token_expiry_from_payload
from .tokens import encrypt_token
from .types import AuthError


def _normalize_email(email: str | None) -> str | None:
    if not email:
        return None
    value = email.strip().lower()
    return value or None


async def _email_exists(session: AsyncSession, email: str) -> bool:
    result = await session.execute(select(User.id).where(User.email == email))
    return result.first() is not None


async def _unique_email(session: AsyncSession, base: str) -> str:
    candidate = base
    if not await _email_exists(session, candidate):
        return candidate
    while True:
        candidate = f"{base.split('@', 1)[0]}+{secrets.token_hex(3)}@{base.split('@', 1)[1]}"
        if not await _email_exists(session, candidate):
            return candidate


async def _bridge_legacy_accounts_for_user(
    session: AsyncSession,
    *,
    user_id: str,
) -> None:
    result = await session.execute(
        select(GitHubAccount)
        .join(Project, Project.github_account_id == GitHubAccount.id)
        .where(Project.user_id == user_id)
    )
    accounts = result.scalars().all()
    for account in accounts:
        identity_result = await session.execute(
            select(AuthIdentity).where(
                AuthIdentity.provider == "github",
                AuthIdentity.provider_user_id == account.github_user_id,
            )
        )
        identity = identity_result.scalar_one_or_none()
        now = datetime.now(timezone.utc)
        if identity is None:
            session.add(
                AuthIdentity(
                    id=str(uuid.uuid4()),
                    user_id=user_id,
                    provider="github",
                    provider_user_id=account.github_user_id,
                    email=None,
                    email_verified=False,
                    login=account.login,
                    access_token_encrypted=account.access_token_encrypted,
                    refresh_token_encrypted=account.refresh_token_encrypted,
                    expires_at=account.expires_at,
                    scope=account.scope,
                    github_account_id=account.id,
                    updated_at=now,
                )
            )
            continue

        identity.user_id = user_id
        identity.login = account.login
        identity.access_token_encrypted = account.access_token_encrypted
        identity.refresh_token_encrypted = account.refresh_token_encrypted
        identity.expires_at = account.expires_at
        identity.scope = account.scope
        identity.github_account_id = account.id
        identity.updated_at = now


async def upsert_user_identity(
    session: AsyncSession,
    *,
    settings: Settings,
    provider: str,
    provider_user_id: str,
    email: str | None,
    email_verified: bool,
    name: str | None,
    avatar_url: str | None,
    login: str | None = None,
    token_payload: dict[str, Any],
    github_account_id: str | None = None,
) -> tuple[User, AuthIdentity, bool, int]:
    provider_user_id = provider_user_id.strip()
    if not provider_user_id:
        raise AuthError("Missing provider user id")

    normalized_email = _normalize_email(email)

    identity_result = await session.execute(
        select(AuthIdentity).where(
            AuthIdentity.provider == provider,
            AuthIdentity.provider_user_id == provider_user_id,
        )
    )
    identity = identity_result.scalar_one_or_none()

    user: User | None = None
    user_created = False
    assigned_legacy_count = 0

    if identity is not None:
        user = await session.get(User, identity.user_id)

    if user is None and normalized_email and email_verified:
        user_result = await session.execute(select(User).where(User.email == normalized_email))
        user = user_result.scalar_one_or_none()

    if user is None:
        users_before = await session.scalar(select(func.count(User.id)))
        fallback_email = normalized_email or f"{provider}-{provider_user_id}@users.local"
        unique_email = await _unique_email(session, fallback_email)
        user = User(
            id=str(uuid.uuid4()),
            email=unique_email,
            name=(name or login or provider_user_id).strip() or provider_user_id,
            avatar_url=avatar_url,
        )
        session.add(user)
        user_created = True
        if int(users_before or 0) == 0:
            result = await session.execute(
                update(Project).where(Project.user_id.is_(None)).values(user_id=user.id)
            )
            assigned_legacy_count = int(result.rowcount or 0)
            if assigned_legacy_count > 0:
                await _bridge_legacy_accounts_for_user(
                    session,
                    user_id=user.id,
                )

    if normalized_email and email_verified and user.email.endswith("@users.local"):
        user.email = await _unique_email(session, normalized_email)
    if name:
        user.name = name.strip() or user.name
    if avatar_url:
        user.avatar_url = avatar_url

    expires_at = token_expiry_from_payload(token_payload)

    if identity is None:
        identity = AuthIdentity(
            id=str(uuid.uuid4()),
            user_id=user.id,
            provider=provider,
            provider_user_id=provider_user_id,
            email=normalized_email,
            email_verified=bool(email_verified),
            login=login,
            access_token_encrypted=encrypt_token(settings, str(token_payload.get("access_token") or "")),
            refresh_token_encrypted=encrypt_token(settings, token_payload.get("refresh_token")),
            expires_at=expires_at,
            scope=str(token_payload.get("scope", "") or ""),
            github_account_id=github_account_id,
            updated_at=datetime.now(timezone.utc),
        )
        session.add(identity)
    else:
        identity.user_id = user.id
        identity.email = normalized_email
        identity.email_verified = bool(email_verified)
        identity.login = login
        identity.access_token_encrypted = encrypt_token(
            settings,
            str(token_payload.get("access_token") or ""),
        )
        identity.refresh_token_encrypted = encrypt_token(settings, token_payload.get("refresh_token"))
        identity.expires_at = expires_at
        identity.scope = str(token_payload.get("scope", "") or "")
        if github_account_id:
            identity.github_account_id = github_account_id
        identity.updated_at = datetime.now(timezone.utc)

    await session.flush()
    return user, identity, user_created, assigned_legacy_count


async def list_user_providers(session: AsyncSession, user_id: str) -> list[str]:
    result = await session.execute(
        select(AuthIdentity.provider).where(AuthIdentity.user_id == user_id)
    )
    providers = sorted({str(row[0]) for row in result.all() if row and row[0]})
    return providers


async def get_user_github_identity(session: AsyncSession, user_id: str) -> AuthIdentity | None:
    result = await session.execute(
        select(AuthIdentity)
        .where(AuthIdentity.user_id == user_id, AuthIdentity.provider == "github")
        .order_by(AuthIdentity.updated_at.desc())
    )
    return result.scalars().first()


async def bridge_legacy_github_accounts(session: AsyncSession, settings: Settings) -> int:
    """Backfill auth_identities from legacy github_accounts rows."""
    result = await session.execute(select(GitHubAccount))
    accounts = result.scalars().all()
    created = 0

    for account in accounts:
        existing = await session.execute(
            select(AuthIdentity).where(
                AuthIdentity.provider == "github",
                AuthIdentity.provider_user_id == account.github_user_id,
            )
        )
        identity = existing.scalar_one_or_none()
        if identity is not None:
            if not identity.github_account_id:
                identity.github_account_id = account.id
                identity.updated_at = datetime.now(timezone.utc)
            continue

        email = f"github-{account.github_user_id}@legacy.users.local"
        unique_email = await _unique_email(session, email)
        user = User(
            id=str(uuid.uuid4()),
            email=unique_email,
            name=account.login,
            avatar_url=None,
        )
        session.add(user)
        await session.flush()

        identity = AuthIdentity(
            id=str(uuid.uuid4()),
            user_id=user.id,
            provider="github",
            provider_user_id=account.github_user_id,
            email=None,
            email_verified=False,
            login=account.login,
            access_token_encrypted=account.access_token_encrypted,
            refresh_token_encrypted=account.refresh_token_encrypted,
            expires_at=account.expires_at,
            scope=account.scope,
            github_account_id=account.id,
            updated_at=datetime.now(timezone.utc),
        )
        session.add(identity)
        created += 1

    return created
