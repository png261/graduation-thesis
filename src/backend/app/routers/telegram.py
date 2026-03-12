"""Telegram webhook endpoint."""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.routers import auth_dependencies as auth_deps
from app.routers.http_errors import raise_http_error
from app.services.telegram import projects as telegram_projects
from app.services.telegram.common import TelegramProjectError

router = APIRouter(prefix="/api/telegram", tags=["telegram"])
logger = logging.getLogger(__name__)


def _validate_webhook_secret(request: Request) -> None:
    settings = get_settings()
    expected_secret = (settings.telegram_webhook_secret or "").strip()
    provided_secret = (request.headers.get("X-Telegram-Bot-Api-Secret-Token") or "").strip()
    if not expected_secret:
        raise_http_error(503, code="telegram_not_configured", message="Telegram is not configured")
    if provided_secret != expected_secret:
        raise_http_error(401, code="telegram_webhook_unauthorized", message="Invalid Telegram webhook secret")


@router.post("/webhook")
async def telegram_webhook(
    payload: dict[str, Any],
    request: Request,
    session: AsyncSession = Depends(auth_deps.get_db_session),
) -> dict:
    _validate_webhook_secret(request)
    code, chat_id = telegram_projects.parse_start_update(payload)
    if not code or not chat_id:
        return {"ok": True, "processed": False}
    try:
        processed = await telegram_projects.complete_pending_connection(
            session,
            settings=get_settings(),
            code=code,
            chat_id=chat_id,
        )
    except TelegramProjectError as exc:
        logger.warning("telegram webhook rejected: %s", exc.message)
        return {"ok": True, "processed": False}
    except Exception:
        logger.exception("telegram webhook failed")
        return {"ok": True, "processed": False}
    return {"ok": True, "processed": processed}
