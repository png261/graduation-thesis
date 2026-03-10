from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models import User, UserSession


async def create_user_session(
    session: AsyncSession,
    *,
    settings: Settings,
    user_id: str,
) -> UserSession:
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=max(1, settings.auth_session_ttl_hours))
    user_session = UserSession(
        id=secrets.token_urlsafe(32),
        user_id=user_id,
        expires_at=expires_at,
    )
    session.add(user_session)
    await session.flush()
    return user_session


async def get_valid_user_session(
    session: AsyncSession,
    *,
    session_id: str | None,
) -> tuple[UserSession | None, User | None]:
    if not session_id:
        return None, None

    result = await session.execute(select(UserSession).where(UserSession.id == session_id))
    user_session = result.scalar_one_or_none()
    if user_session is None:
        return None, None

    if user_session.expires_at <= datetime.now(timezone.utc):
        await session.delete(user_session)
        return None, None

    user = await session.get(User, user_session.user_id)
    if user is None:
        return None, None

    return user_session, user


async def delete_user_session(session: AsyncSession, *, session_id: str | None) -> None:
    if not session_id:
        return
    result = await session.execute(select(UserSession).where(UserSession.id == session_id))
    user_session = result.scalar_one_or_none()
    if user_session is not None:
        await session.delete(user_session)
