from __future__ import annotations

import hashlib
import logging
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models import Project, User
from app.services.telegram import api as telegram_api
from app.services.telegram.common import TelegramApiError, TelegramProjectError

CONNECT_CODE_TTL_MINUTES = 5
logger = logging.getLogger(__name__)
_START_COMMAND = re.compile(r"^/(?:start|startgroup)(?:@[A-Za-z0-9_]+)?(?:\s+(.+))?$")


@dataclass(slots=True)
class TelegramRuntimeConfig:
    bot_token: str
    webhook_url: str
    webhook_secret: str


def load_runtime_config(settings: Settings) -> TelegramRuntimeConfig:
    bot_token = (settings.telegram_bot_token or "").strip()
    webhook_url = (settings.telegram_webhook_url or "").strip()
    webhook_secret = (settings.telegram_webhook_secret or "").strip()
    if bot_token and webhook_url and webhook_secret:
        return TelegramRuntimeConfig(bot_token=bot_token, webhook_url=webhook_url, webhook_secret=webhook_secret)
    raise TelegramProjectError(
        "Telegram is not configured",
        status_code=503,
        code="telegram_not_configured",
    )


def _is_pending(project: Project, now: datetime) -> bool:
    return bool(
        project.telegram_pending_code_hash
        and project.telegram_pending_expires_at
        and project.telegram_pending_expires_at > now
    )


def _requires_reconnect(project: Project) -> bool:
    return bool(project.telegram_chat_id and not project.telegram_topic_id)


def _is_connected(project: Project) -> bool:
    return bool(project.telegram_connected_at)


def connection_payload(project: Project, *, now: datetime | None = None) -> dict[str, Any]:
    current_time = now or datetime.now(timezone.utc)
    pending = _is_pending(project, current_time)
    requires_reconnect = _requires_reconnect(project)
    return {
        "connected": _is_connected(project),
        "chat_id": project.telegram_chat_id,
        "topic_id": project.telegram_topic_id,
        "topic_title": project.telegram_topic_title,
        "requires_reconnect": requires_reconnect,
        "connected_at": project.telegram_connected_at.isoformat() if project.telegram_connected_at else None,
        "pending": pending,
        "pending_expires_at": project.telegram_pending_expires_at.isoformat() if pending else None,
    }


def hash_connect_code(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def generate_connect_code() -> str:
    return secrets.token_urlsafe(24)


def _ensure_connectable(project: Project) -> None:
    if not _is_connected(project):
        return
    if _requires_reconnect(project):
        raise TelegramProjectError(
            "Legacy Telegram connection requires reconnect",
            status_code=409,
            code="telegram_legacy_reconnect_required",
        )
    if project.telegram_topic_id:
        raise TelegramProjectError(
            "Project is already connected to Telegram",
            status_code=409,
            code="telegram_already_connected",
        )


def _bot_username(bot_profile: dict[str, Any]) -> str:
    username = str(bot_profile.get("username") or "").strip()
    if username:
        return username
    raise TelegramProjectError(
        "Telegram bot username is unavailable",
        status_code=400,
        code="telegram_bot_invalid",
    )


def _connect_url(bot_username: str, code: str) -> str:
    return f"https://t.me/{bot_username}?startgroup={code}"


async def issue_connect_link(
    session: AsyncSession,
    *,
    project: Project,
    settings: Settings,
) -> dict[str, Any]:
    runtime = load_runtime_config(settings)
    _ensure_connectable(project)
    try:
        await telegram_api.set_webhook(runtime.bot_token, runtime.webhook_url, runtime.webhook_secret)
        bot_username = _bot_username(await telegram_api.get_me(runtime.bot_token))
    except TelegramApiError as exc:
        raise TelegramProjectError(str(exc), status_code=400, code="telegram_connect_failed") from exc
    code = generate_connect_code()
    now = datetime.now(timezone.utc)
    project.telegram_pending_code_hash = hash_connect_code(code)
    project.telegram_pending_expires_at = now + timedelta(minutes=CONNECT_CODE_TTL_MINUTES)
    await session.flush()
    payload = connection_payload(project, now=now)
    payload["connect_url"] = _connect_url(bot_username, code)
    return payload


def _safe_name(user: User | None) -> str:
    if user and str(user.name or "").strip():
        return str(user.name).strip()
    return "user"


def _project_label(project: Project) -> str:
    clean_name = project.name.strip() or "Untitled Project"
    return f"{clean_name} ({project.id})"


def _greeting(*, user_name: str, project: Project) -> str:
    return f"Xin chao {user_name}! Project {_project_label(project)} da duoc setup Telegram thanh cong."


def _farewell(*, user_name: str, project: Project) -> str:
    return f"Tam biet {user_name}! Project {_project_label(project)} da ngat ket noi. Topic van duoc giu lai."


async def disconnect_project(
    session: AsyncSession,
    *,
    project: Project,
    settings: Settings,
) -> dict[str, Any]:
    warning: str | None = None
    can_send = bool(project.telegram_connected_at and project.telegram_chat_id and project.telegram_topic_id)
    if can_send:
        try:
            runtime = load_runtime_config(settings)
            user = await _project_user(session, project)
            await telegram_api.send_message(
                runtime.bot_token,
                str(project.telegram_chat_id),
                _farewell(user_name=_safe_name(user), project=project),
                message_thread_id=project.telegram_topic_id,
            )
        except Exception as exc:
            logger.warning("telegram farewell skipped for project %s: %s", project.id, str(exc))
            warning = "disconnect_farewell_failed"
    project.telegram_connected_at = None
    project.telegram_pending_code_hash = None
    project.telegram_pending_expires_at = None
    await session.flush()
    payload = connection_payload(project)
    if warning:
        payload["warning"] = warning
    return payload


def extract_start_code(text: str) -> str | None:
    value = (text or "").strip()
    match = _START_COMMAND.match(value)
    if not match:
        return None
    code = str(match.group(1) or "").strip()
    return code or None


def parse_start_update(update: dict[str, Any]) -> tuple[str | None, str | None]:
    message = update.get("message")
    if not isinstance(message, dict):
        return None, None
    text = str(message.get("text") or "")
    code = extract_start_code(text)
    if not code:
        return None, None
    chat = message.get("chat")
    if not isinstance(chat, dict):
        return None, None
    chat_id = chat.get("id")
    if chat_id is None:
        return None, None
    return code, str(chat_id)


def _expire_pending(project: Project) -> None:
    project.telegram_pending_code_hash = None
    project.telegram_pending_expires_at = None


def _topic_title(project: Project) -> str:
    suffix = project.id[:8]
    base = project.name.strip() or "project"
    max_base = max(1, 128 - len(suffix) - 3)
    return f"{base[:max_base]} - {suffix}"


async def _project_by_pending_code(session: AsyncSession, code_hash: str) -> Project | None:
    result = await session.execute(select(Project).where(Project.telegram_pending_code_hash == code_hash))
    return result.scalars().first()


async def _project_user(session: AsyncSession, project: Project) -> User | None:
    if not project.user_id:
        return None
    return await session.get(User, project.user_id)


async def _chat_owned_by_another_user(
    session: AsyncSession,
    *,
    project: Project,
    chat_id: str,
) -> bool:
    result = await session.execute(
        select(Project.id)
        .where(Project.telegram_chat_id == chat_id, Project.id != project.id, Project.user_id != project.user_id)
        .limit(1)
    )
    return result.scalar_one_or_none() is not None


async def _assert_group_with_topics(runtime: TelegramRuntimeConfig, *, chat_id: str) -> None:
    chat = await telegram_api.get_chat(runtime.bot_token, chat_id)
    chat_type = str(chat.get("type") or "")
    is_forum = bool(chat.get("is_forum"))
    if chat_type != "supergroup" or not is_forum:
        raise TelegramProjectError(
            "Telegram connect must be completed in a forum-enabled supergroup",
            status_code=400,
            code="telegram_group_required",
        )


async def _resolve_topic(
    *,
    runtime: TelegramRuntimeConfig,
    project: Project,
    chat_id: str,
) -> tuple[str, str]:
    if project.telegram_topic_id:
        if project.telegram_chat_id and project.telegram_chat_id != chat_id:
            raise TelegramProjectError(
                "Reconnect must use the same Telegram group",
                status_code=409,
                code="telegram_chat_owner_conflict",
            )
        title = project.telegram_topic_title or _topic_title(project)
        return str(project.telegram_topic_id), title
    try:
        topic = await telegram_api.create_forum_topic(runtime.bot_token, chat_id, _topic_title(project))
    except TelegramApiError as exc:
        raise TelegramProjectError(
            "Telegram topic creation failed",
            status_code=400,
            code="telegram_topic_create_failed",
        ) from exc
    topic_id = topic.get("message_thread_id")
    if topic_id is None:
        raise TelegramProjectError(
            "Telegram topic creation failed",
            status_code=400,
            code="telegram_topic_create_failed",
        )
    topic_title = str(topic.get("name") or _topic_title(project))
    return str(topic_id), topic_title


async def complete_pending_connection(
    session: AsyncSession,
    *,
    settings: Settings,
    code: str,
    chat_id: str,
) -> bool:
    runtime = load_runtime_config(settings)
    code_hash = hash_connect_code(code)
    project = await _project_by_pending_code(session, code_hash)
    if project is None:
        return False
    now = datetime.now(timezone.utc)
    if not _is_pending(project, now):
        _expire_pending(project)
        await session.flush()
        return False
    if _is_connected(project):
        _expire_pending(project)
        await session.flush()
        return False
    await _assert_group_with_topics(runtime, chat_id=chat_id)
    if await _chat_owned_by_another_user(session, project=project, chat_id=chat_id):
        raise TelegramProjectError(
            "Telegram group is already owned by another user",
            status_code=409,
            code="telegram_chat_owner_conflict",
        )
    topic_id, topic_title = await _resolve_topic(
        runtime=runtime,
        project=project,
        chat_id=chat_id,
    )
    user = await _project_user(session, project)
    try:
        await telegram_api.send_message(
            runtime.bot_token,
            chat_id,
            _greeting(user_name=_safe_name(user), project=project),
            message_thread_id=topic_id,
        )
    except TelegramApiError:
        return False
    project.telegram_chat_id = chat_id
    project.telegram_topic_id = topic_id
    project.telegram_topic_title = topic_title
    project.telegram_connected_at = now
    _expire_pending(project)
    await session.flush()
    return True
