"""Shared auth dependencies for app-session based access control."""
from __future__ import annotations

from dataclasses import dataclass
from typing import AsyncGenerator

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import db
from app.models import Project, User, UserSession
from app.routers.http_errors import error_detail, raise_http_error
from app.services.auth import service as auth_service


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    async with db.get_session() as session:
        yield session


def get_app_session_id(request: Request) -> str | None:
    return request.cookies.get(auth_service.APP_SESSION_COOKIE)


@dataclass(slots=True)
class CurrentSessionContext:
    session_id: str | None
    session: UserSession | None
    user: User | None


async def get_current_session_context(
    session_id: str | None = Depends(get_app_session_id),
) -> CurrentSessionContext:
    if not session_id:
        return CurrentSessionContext(session_id=None, session=None, user=None)

    async with db.get_session() as session:
        user_session, user = await auth_service.get_valid_user_session(
            session,
            session_id=session_id,
        )
    return CurrentSessionContext(session_id=session_id, session=user_session, user=user)


async def get_current_user_optional(
    ctx: CurrentSessionContext = Depends(get_current_session_context),
) -> User | None:
    return ctx.user


async def require_current_user(
    ctx: CurrentSessionContext = Depends(get_current_session_context),
) -> User:
    if ctx.user is None:
        raise_http_error(401, code="login_required", message="Login required")
    return ctx.user


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
