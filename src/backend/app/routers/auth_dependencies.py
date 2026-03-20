"""Shared auth dependencies backed by Clerk Bearer token verification."""
from __future__ import annotations

from typing import AsyncGenerator

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import db
from app.core.config import get_settings
from app.models import Project, User
from app.routers.http_errors import raise_http_error
import app.services.clerk as clerk_service


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    async with db.get_session() as session:
        yield session


async def _ensure_user_exists(clerk_user_id: str) -> User:
    async with db.get_session() as session:
        user = await session.get(User, clerk_user_id)
        if user is not None:
            return user

        fallback_email = f"clerk-{clerk_user_id}@users.local"
        user = User(
            id=clerk_user_id,
            email=fallback_email,
            name=f"user-{clerk_user_id[:8]}",
            avatar_url=None,
        )
        session.add(user)
        await session.flush()
        return user


async def get_current_user_optional(request: Request) -> User | None:
    settings = get_settings()

    try:
        session = clerk_service.authenticate_bearer(
            settings=settings,
            headers=request.headers,
        )
    except clerk_service.ClerkError as exc:
        raise_http_error(500, code="auth_config_error", message=str(exc))
    except Exception:
        return None

    if session is None:
        return None
    return await _ensure_user_exists(session.user_id)


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
    result = await session.execute(
        select(Project).where(Project.id == project_id, Project.user_id == user.id)
    )
    project = result.scalar_one_or_none()
    if project is None:
        raise_http_error(404, code="project_not_found", message="Project not found")
    return project
