from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.chat import ChatMessage


def test_chat_message_accepts_supported_roles() -> None:
    for role in ("user", "assistant", "system"):
        payload = ChatMessage(role=role, content="hello")
        assert payload.role.value == role


def test_chat_message_rejects_invalid_role() -> None:
    with pytest.raises(ValidationError):
        ChatMessage(role="tool", content="hello")
