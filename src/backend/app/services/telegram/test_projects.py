from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any

import pytest

from app.models import Project, User
from app.services.telegram import projects as telegram_projects
from app.services.telegram.common import TelegramApiError, TelegramProjectError


class _FakeSession:
    def __init__(self, user: User | None = None) -> None:
        self.user = user
        self.flush_count = 0

    async def flush(self) -> None:
        self.flush_count += 1

    async def get(self, model: type[Any], key: str) -> User | None:
        if model is User and self.user and self.user.id == key:
            return self.user
        return None


def _settings():
    return SimpleNamespace(
        telegram_bot_token="token",
        telegram_webhook_url="https://example.com/api/telegram/webhook",
        telegram_webhook_secret="secret",
    )


def _project() -> Project:
    return Project(id="project-1", user_id="user-1", name="Demo Project")


def _pending_project(code: str) -> Project:
    project = _project()
    project.telegram_pending_code_hash = telegram_projects.hash_connect_code(code)
    project.telegram_pending_expires_at = datetime.now(timezone.utc) + timedelta(minutes=1)
    return project


@pytest.mark.asyncio
async def test_issue_connect_link_creates_pending_and_startgroup_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _set_webhook(*_args, **_kwargs):
        return {"ok": True}

    async def _get_me(*_args, **_kwargs):
        return {"username": "demo_bot"}

    monkeypatch.setattr(telegram_projects.telegram_api, "set_webhook", _set_webhook)
    monkeypatch.setattr(telegram_projects.telegram_api, "get_me", _get_me)

    project = _project()
    session = _FakeSession()
    result = await telegram_projects.issue_connect_link(session, project=project, settings=_settings())

    assert result["connected"] is False
    assert result["pending"] is True
    assert result["pending_expires_at"] is not None
    assert result["connect_url"].startswith("https://t.me/demo_bot?startgroup=")
    assert project.telegram_pending_code_hash
    assert project.telegram_pending_expires_at is not None
    assert project.telegram_pending_expires_at > datetime.now(timezone.utc)


@pytest.mark.asyncio
async def test_issue_connect_link_rejects_connected_project() -> None:
    project = _project()
    project.telegram_connected_at = datetime.now(timezone.utc)
    project.telegram_chat_id = "-100123"
    project.telegram_topic_id = "42"
    with pytest.raises(TelegramProjectError) as exc:
        await telegram_projects.issue_connect_link(_FakeSession(), project=project, settings=_settings())
    assert exc.value.code == "telegram_already_connected"
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_issue_connect_link_rejects_legacy_connection() -> None:
    project = _project()
    project.telegram_connected_at = datetime.now(timezone.utc)
    project.telegram_chat_id = "-100123"
    project.telegram_topic_id = None
    with pytest.raises(TelegramProjectError) as exc:
        await telegram_projects.issue_connect_link(_FakeSession(), project=project, settings=_settings())
    assert exc.value.code == "telegram_legacy_reconnect_required"
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_complete_pending_connection_success_sets_topic_and_clears_pending(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sent: dict[str, Any] = {}
    code = "abc123"
    project = _pending_project(code)
    session = _FakeSession(user=User(id="user-1", email="a@example.com", name="Alice", avatar_url=None))

    async def _project_by_code(*_args, **_kwargs):
        return project

    async def _get_chat(*_args, **_kwargs):
        return {"type": "supergroup", "is_forum": True}

    async def _create_topic(*_args, **_kwargs):
        return {"message_thread_id": 77, "name": "Demo Topic"}

    async def _send_message(_token, _chat_id, text, *, message_thread_id=None):
        sent["text"] = text
        sent["message_thread_id"] = message_thread_id
        return {"message_id": 1}

    async def _no_conflict(*_args, **_kwargs):
        return False

    monkeypatch.setattr(telegram_projects, "_project_by_pending_code", _project_by_code)
    monkeypatch.setattr(telegram_projects, "_chat_owned_by_another_user", _no_conflict)
    monkeypatch.setattr(telegram_projects.telegram_api, "get_chat", _get_chat)
    monkeypatch.setattr(telegram_projects.telegram_api, "create_forum_topic", _create_topic)
    monkeypatch.setattr(telegram_projects.telegram_api, "send_message", _send_message)

    processed = await telegram_projects.complete_pending_connection(
        session,
        settings=_settings(),
        code=code,
        chat_id="-100123456",
    )

    assert processed is True
    assert project.telegram_chat_id == "-100123456"
    assert project.telegram_topic_id == "77"
    assert project.telegram_topic_title == "Demo Topic"
    assert project.telegram_connected_at is not None
    assert project.telegram_pending_code_hash is None
    assert project.telegram_pending_expires_at is None
    assert "Alice" in sent["text"]
    assert project.id in sent["text"]
    assert sent["message_thread_id"] == "77"


@pytest.mark.asyncio
async def test_complete_pending_connection_reuses_existing_topic(monkeypatch: pytest.MonkeyPatch) -> None:
    code = "abc123"
    project = _pending_project(code)
    project.telegram_chat_id = "-100123456"
    project.telegram_topic_id = "88"
    project.telegram_topic_title = "Existing Topic"
    session = _FakeSession(user=User(id="user-1", email="a@example.com", name="Alice", avatar_url=None))
    called = {"create_topic": False}

    async def _project_by_code(*_args, **_kwargs):
        return project

    async def _get_chat(*_args, **_kwargs):
        return {"type": "supergroup", "is_forum": True}

    async def _create_topic(*_args, **_kwargs):
        called["create_topic"] = True
        return {"message_thread_id": 100}

    async def _send_message(*_args, **_kwargs):
        return {"message_id": 1}

    async def _no_conflict(*_args, **_kwargs):
        return False

    monkeypatch.setattr(telegram_projects, "_project_by_pending_code", _project_by_code)
    monkeypatch.setattr(telegram_projects, "_chat_owned_by_another_user", _no_conflict)
    monkeypatch.setattr(telegram_projects.telegram_api, "get_chat", _get_chat)
    monkeypatch.setattr(telegram_projects.telegram_api, "create_forum_topic", _create_topic)
    monkeypatch.setattr(telegram_projects.telegram_api, "send_message", _send_message)

    processed = await telegram_projects.complete_pending_connection(
        session,
        settings=_settings(),
        code=code,
        chat_id="-100123456",
    )

    assert processed is True
    assert called["create_topic"] is False
    assert project.telegram_topic_id == "88"


@pytest.mark.asyncio
async def test_complete_pending_connection_rejects_chat_owner_conflict(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    code = "abc123"
    project = _pending_project(code)

    async def _project_by_code(*_args, **_kwargs):
        return project

    async def _get_chat(*_args, **_kwargs):
        return {"type": "supergroup", "is_forum": True}

    async def _has_conflict(*_args, **_kwargs):
        return True

    monkeypatch.setattr(telegram_projects, "_project_by_pending_code", _project_by_code)
    monkeypatch.setattr(telegram_projects, "_chat_owned_by_another_user", _has_conflict)
    monkeypatch.setattr(telegram_projects.telegram_api, "get_chat", _get_chat)

    with pytest.raises(TelegramProjectError) as exc:
        await telegram_projects.complete_pending_connection(
            _FakeSession(),
            settings=_settings(),
            code=code,
            chat_id="-100123456",
        )
    assert exc.value.code == "telegram_chat_owner_conflict"


@pytest.mark.asyncio
async def test_complete_pending_connection_requires_forum_group(monkeypatch: pytest.MonkeyPatch) -> None:
    code = "abc123"
    project = _pending_project(code)

    async def _project_by_code(*_args, **_kwargs):
        return project

    async def _get_chat(*_args, **_kwargs):
        return {"type": "supergroup", "is_forum": False}

    async def _no_conflict(*_args, **_kwargs):
        return False

    monkeypatch.setattr(telegram_projects, "_project_by_pending_code", _project_by_code)
    monkeypatch.setattr(telegram_projects, "_chat_owned_by_another_user", _no_conflict)
    monkeypatch.setattr(telegram_projects.telegram_api, "get_chat", _get_chat)

    with pytest.raises(TelegramProjectError) as exc:
        await telegram_projects.complete_pending_connection(
            _FakeSession(),
            settings=_settings(),
            code=code,
            chat_id="-100123456",
        )
    assert exc.value.code == "telegram_group_required"
    assert project.telegram_pending_code_hash is not None
    assert project.telegram_pending_expires_at is not None


@pytest.mark.asyncio
async def test_complete_pending_connection_does_not_persist_on_send_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    code = "abc123"
    project = _pending_project(code)

    async def _project_by_code(*_args, **_kwargs):
        return project

    async def _get_chat(*_args, **_kwargs):
        return {"type": "supergroup", "is_forum": True}

    async def _create_topic(*_args, **_kwargs):
        return {"message_thread_id": 88, "name": "Demo Topic"}

    async def _send_message(*_args, **_kwargs):
        raise TelegramApiError("send failed")

    async def _no_conflict(*_args, **_kwargs):
        return False

    monkeypatch.setattr(telegram_projects, "_project_by_pending_code", _project_by_code)
    monkeypatch.setattr(telegram_projects, "_chat_owned_by_another_user", _no_conflict)
    monkeypatch.setattr(telegram_projects.telegram_api, "get_chat", _get_chat)
    monkeypatch.setattr(telegram_projects.telegram_api, "create_forum_topic", _create_topic)
    monkeypatch.setattr(telegram_projects.telegram_api, "send_message", _send_message)

    processed = await telegram_projects.complete_pending_connection(
        _FakeSession(),
        settings=_settings(),
        code=code,
        chat_id="-100123456",
    )

    assert processed is False
    assert project.telegram_chat_id is None
    assert project.telegram_topic_id is None
    assert project.telegram_connected_at is None
    assert project.telegram_pending_code_hash is not None
    assert project.telegram_pending_expires_at is not None


@pytest.mark.asyncio
async def test_complete_pending_connection_expires_pending_state(monkeypatch: pytest.MonkeyPatch) -> None:
    project = _project()
    code = "abc123"
    project.telegram_pending_code_hash = telegram_projects.hash_connect_code(code)
    project.telegram_pending_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)

    async def _project_by_code(*_args, **_kwargs):
        return project

    monkeypatch.setattr(telegram_projects, "_project_by_pending_code", _project_by_code)

    processed = await telegram_projects.complete_pending_connection(
        _FakeSession(),
        settings=_settings(),
        code=code,
        chat_id="-100123456",
    )

    assert processed is False
    assert project.telegram_pending_code_hash is None
    assert project.telegram_pending_expires_at is None


@pytest.mark.asyncio
async def test_disconnect_sends_farewell_and_keeps_topic(monkeypatch: pytest.MonkeyPatch) -> None:
    project = _project()
    project.telegram_chat_id = "-100123456"
    project.telegram_topic_id = "77"
    project.telegram_topic_title = "Demo Topic"
    project.telegram_connected_at = datetime.now(timezone.utc)
    session = _FakeSession(user=User(id="user-1", email="a@example.com", name="Alice", avatar_url=None))
    sent = {"thread": None}

    async def _send_message(*_args, **kwargs):
        sent["thread"] = kwargs.get("message_thread_id")
        return {"message_id": 1}

    monkeypatch.setattr(telegram_projects.telegram_api, "send_message", _send_message)

    payload = await telegram_projects.disconnect_project(
        session,
        project=project,
        settings=_settings(),
    )

    assert payload["connected"] is False
    assert payload.get("warning") is None
    assert project.telegram_chat_id == "-100123456"
    assert project.telegram_topic_id == "77"
    assert project.telegram_connected_at is None
    assert sent["thread"] == "77"


@pytest.mark.asyncio
async def test_disconnect_still_succeeds_when_farewell_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    project = _project()
    project.telegram_chat_id = "-100123456"
    project.telegram_topic_id = "77"
    project.telegram_connected_at = datetime.now(timezone.utc)

    async def _send_message(*_args, **_kwargs):
        raise TelegramApiError("send failed")

    monkeypatch.setattr(telegram_projects.telegram_api, "send_message", _send_message)

    payload = await telegram_projects.disconnect_project(
        _FakeSession(),
        project=project,
        settings=_settings(),
    )

    assert payload["connected"] is False
    assert payload["warning"] == "disconnect_farewell_failed"
    assert project.telegram_connected_at is None


def test_parse_start_update_extracts_code_and_chat_id() -> None:
    update = {
        "message": {
            "text": "/start@demo_bot demo-code",
            "chat": {"id": -100987654321},
        }
    }
    code, chat_id = telegram_projects.parse_start_update(update)
    assert code == "demo-code"
    assert chat_id == "-100987654321"
