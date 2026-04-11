from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app import conversation_routes, main
from app.schemas.chat import ChatRequest


async def _inline_events():
    yield {"type": "text.delta", "delta": "hello"}


class MainChatStreamInlineTests(unittest.IsolatedAsyncioTestCase):
    async def test_main_chat_stream_runs_inline_without_queue(self) -> None:
        payload = ChatRequest.model_validate(
            {
                "project_id": "project-1",
                "thread_id": "thread-1",
                "messages": [{"role": "user", "content": "hello"}],
            }
        )
        request = SimpleNamespace(is_disconnected=AsyncMock(return_value=False))
        user = SimpleNamespace(id="user-1")
        project = SimpleNamespace(id="project-1", user_id="user-1")

        with (
            patch.object(main, "_validate_chat_access", AsyncMock(return_value=project)),
            patch.object(main, "_ensure_project_thread", AsyncMock()),
            patch.object(main.chat_service, "ensure_settings"),
            patch.object(main.chat_service, "ensure_payload"),
            patch.object(main.chat_service, "stream_response_events", return_value=_inline_events()),
        ):
            response = await main.chat_stream(payload, request, user)
            events = [event async for event in response.body_iterator]

        self.assertEqual(
            events,
            [
                '{"type": "text.delta", "delta": "hello"}',
                '{"type": "done"}',
            ],
        )


class ConversationChatStreamInlineTests(unittest.IsolatedAsyncioTestCase):
    async def test_conversation_chat_stream_runs_inline_without_queue(self) -> None:
        payload = ChatRequest.model_validate(
            {
                "project_id": "project-1",
                "thread_id": "thread-1",
                "messages": [{"role": "user", "content": "hello"}],
            }
        )
        request = SimpleNamespace(is_disconnected=AsyncMock(return_value=False))
        user = SimpleNamespace(id="user-1")
        project = SimpleNamespace(id="project-1", user_id="user-1")

        with (
            patch.object(conversation_routes, "_validate_chat_access", AsyncMock(return_value=project)),
            patch.object(conversation_routes, "_ensure_project_thread", AsyncMock()),
            patch.object(conversation_routes.conversation_service, "ensure_settings"),
            patch.object(conversation_routes.conversation_service, "ensure_payload"),
            patch.object(
                conversation_routes.conversation_service, "stream_response_events", return_value=_inline_events()
            ),
        ):
            response = await conversation_routes.chat_stream(payload, request, user)
            events = [event async for event in response.body_iterator]

        self.assertEqual(
            events,
            [
                '{"type": "text.delta", "delta": "hello"}',
                '{"type": "done"}',
            ],
        )


if __name__ == "__main__":
    unittest.main()
