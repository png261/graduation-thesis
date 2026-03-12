"""Project Telegram connect/disconnect/status endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Project
from app.routers import auth_dependencies as auth_deps
from app.routers.http_errors import raise_http_error
from app.services.telegram import projects as telegram_projects
from app.services.telegram.common import TelegramProjectError

router = APIRouter()


def _raise_telegram_project_error(exc: TelegramProjectError) -> None:
    raise_http_error(exc.status_code, code=exc.code, message=exc.message)


@router.get("/{project_id}/telegram")
async def project_telegram_status(
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    return telegram_projects.connection_payload(project)


@router.post("/{project_id}/telegram/connect")
async def connect_project_telegram(
    session: AsyncSession = Depends(auth_deps.get_db_session),
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    owned = await session.get(Project, project.id)
    if owned is None:
        raise HTTPException(status_code=404, detail="Project not found")
    try:
        return await telegram_projects.issue_connect_link(
            session,
            project=owned,
            settings=get_settings(),
        )
    except TelegramProjectError as exc:
        _raise_telegram_project_error(exc)
    raise_http_error(500, code="telegram_connect_failed", message="Telegram connect failed")


@router.post("/{project_id}/telegram/disconnect")
async def disconnect_project_telegram(
    session: AsyncSession = Depends(auth_deps.get_db_session),
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    owned = await session.get(Project, project.id)
    if owned is None:
        raise HTTPException(status_code=404, detail="Project not found")
    try:
        return await telegram_projects.disconnect_project(
            session,
            project=owned,
            settings=get_settings(),
        )
    except TelegramProjectError as exc:
        _raise_telegram_project_error(exc)
    raise_http_error(500, code="telegram_disconnect_failed", message="Telegram disconnect failed")
