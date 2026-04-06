from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from langchain_core.messages import AIMessage

from app.core.config import Settings
from app.schemas.chat import ChatMessage, ChatRequest, ChatRole
from app.services.chat import service


class FakeStreamingAgent:
    def __init__(self, message: AIMessage) -> None:
        self._message = message

    async def astream(self, *_args, **_kwargs):
        yield self._message


class FakeInvokeAgent:
    def __init__(self, result: object) -> None:
        self._result = result

    def invoke(self, *_args, **_kwargs) -> object:
        return self._result


def build_payload() -> ChatRequest:
    return ChatRequest(messages=[ChatMessage(role=ChatRole.user, content="hello")])


def build_settings() -> Settings:
    return Settings()


class ChatServiceUsageCleanupTests(unittest.IsolatedAsyncioTestCase):
    async def test_stream_response_events_omits_usage_event(self) -> None:
        agent = FakeStreamingAgent(AIMessage(content=[{"type": "text", "text": "Hello"}]))
        with patch.object(service, "_load_blueprint_preflight", AsyncMock(return_value=([], True))):
            with patch.object(service, "get_agent", AsyncMock(return_value=agent)):
                events = [event async for event in service.stream_response_events(build_payload(), build_settings())]
        self.assertIn({"type": "text.delta", "delta": "Hello"}, events)
        self.assertNotIn("usage", [event["type"] for event in events])

    async def test_generate_response_reads_structured_text(self) -> None:
        result = {"messages": [AIMessage(content=[{"type": "text", "text": "Hello world"}])]}
        with patch.object(service, "get_agent", AsyncMock(return_value=FakeInvokeAgent(result))):
            text = await service.generate_response(build_payload(), build_settings())
        self.assertEqual(text, "Hello world")

    async def test_generate_basic_response_reads_structured_text(self) -> None:
        model = FakeInvokeAgent(AIMessage(content=[{"type": "text", "text": "Guest hello"}]))
        with patch.object(service, "create_chat_model", return_value=model):
            text = await service.generate_basic_response(build_payload(), build_settings())
        self.assertEqual(text, "Guest hello")


if __name__ == "__main__":
    unittest.main()
