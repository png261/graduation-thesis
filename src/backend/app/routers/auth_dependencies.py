"""Shared auth dependencies backed by Cognito Bearer token verification."""

from __future__ import annotations

from typing import AsyncGenerator

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import app.services.cognito as cognito_service
from app import db
from app.core.config import get_settings
from app.models import Project, User
from app.routers.http_errors import raise_http_error


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    async with db.get_session() as session:
        yield session


def _claim_text(claims: dict[str, object], *keys: str) -> str:
    for key in keys:
        value = claims.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


async def _ensure_user_exists(user_id: str, claims: dict[str, object]) -> User:
    async with db.get_session() as session:
        user = await session.get(User, user_id)
        fallback_email = _claim_text(claims, "email") or f"cognito-{user_id}@users.local"
        fallback_name = _claim_text(claims, "name", "preferred_username", "cognito:username") or f"user-{user_id[:8]}"
        avatar_url = _claim_text(claims, "picture") or None
        if user is None:
            user = User(id=user_id, email=fallback_email, name=fallback_name, avatar_url=avatar_url)
            session.add(user)
        else:
            user.email = fallback_email
            user.name = fallback_name
            user.avatar_url = avatar_url
        await session.flush()
        return user


async def get_current_user_optional(request: Request) -> User | None:
    settings = get_settings()
    try:
        session = await cognito_service.authenticate_bearer(
            settings=settings,
            headers=request.headers,
        )
    except cognito_service.CognitoConfigError as exc:
        raise_http_error(500, code="auth_config_error", message=str(exc))
    except Exception:
        return None
    if session is None:
        return None
    return await _ensure_user_exists(session.user_id, session.claims)


async def require_current_user(
    user: User | None = Depends(get_current_user_optional),
) -> User:
    if user is None:
        raise_http_error(401, code="login_required", message="Login required")
    return user


async def get_owned_project_or_404(
    project_id: str,
    user: User = Depends(require_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> Project:
    result = await session.execute(select(Project).where(Project.id == project_id, Project.user_id == user.id))
    project = result.scalar_one_or_none()
    if project is None:
        raise_http_error(404, code="project_not_found", message="Project not found")
    return project
