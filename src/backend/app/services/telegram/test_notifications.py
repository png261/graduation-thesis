from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.models import Project
from app.services.telegram import notifications as telegram_notifications
from app.services.telegram.common import TelegramApiError


def _project(
    *,
    chat_id: str | None = "-10012345",
    topic_id: str | None = "77",
    connected: bool = True,
) -> Project:
    project = Project(id="project-1", user_id="user-1", name="Demo Project")
    project.telegram_chat_id = chat_id
    project.telegram_topic_id = topic_id
    project.telegram_topic_title = "Demo Topic"
    project.telegram_connected_at = datetime.now(timezone.utc) if connected else None
    return project


def _settings():
    return SimpleNamespace(
        telegram_bot_token="token",
        telegram_webhook_url="https://example.com/api/telegram/webhook",
        telegram_webhook_secret="secret",
    )


def test_github_pull_request_text_includes_project_header() -> None:
    project = _project()
    text = telegram_notifications.github_pull_request_text(
        project,
        {"number": 7, "title": "Add alert", "repo_full_name": "owner/repo", "url": "https://github.com/pull/7"},
    )
    assert project.name in text
    assert project.id in text
    assert "GitHub PR created" in text


def test_policy_check_text_success() -> None:
    text = telegram_notifications.policy_check_text(
        _project(),
        {
            "summary": {"total": 4, "bySeverity": {"critical": 1, "high": 2, "medium": 1}},
            "changedPaths": ["a.tf", "b.tf"],
            "scanError": None,
        },
    )
    assert "Policy check completed" in text
    assert "Total issues: 4" in text
    assert "critical:1" in text


@pytest.mark.asyncio
async def test_notify_project_skips_without_topic() -> None:
    ok = await telegram_notifications.notify_project(_project(topic_id=None), _settings(), "hello")
    assert ok is False


@pytest.mark.asyncio
async def test_notify_project_skips_when_legacy_requires_reconnect() -> None:
    project = _project(topic_id=None)
    project.telegram_chat_id = "-10012345"
    project.telegram_connected_at = datetime.now(timezone.utc)
    ok = await telegram_notifications.notify_project(project, _settings(), "hello")
    assert ok is False


@pytest.mark.asyncio
async def test_notify_project_success_routes_to_topic(monkeypatch: pytest.MonkeyPatch) -> None:
    called = {"thread": None, "text": ""}

    async def _send_message(*args, **kwargs):
        called["thread"] = kwargs.get("message_thread_id")
        called["text"] = str(args[2])
        return {"message_id": 1}

    monkeypatch.setattr(telegram_notifications.telegram_api, "send_message", _send_message)
    project = _project()
    ok = await telegram_notifications.notify_project(project, _settings(), "hello")
    assert ok is True
    assert called["thread"] == "77"
    assert project.name in called["text"]
    assert project.id in called["text"]


@pytest.mark.asyncio
async def test_notify_project_handles_send_error(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _send_message(*_args, **_kwargs):
        raise TelegramApiError("send failed")

    monkeypatch.setattr(telegram_notifications.telegram_api, "send_message", _send_message)
    ok = await telegram_notifications.notify_project(_project(), _settings(), "hello")
    assert ok is False
