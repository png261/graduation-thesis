from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class ChatRole(str, Enum):
    user = "user"
    assistant = "assistant"
    system = "system"


class ChatMessage(BaseModel):
    role: ChatRole = Field(..., description="user | assistant | system")
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    thread_id: str | None = None
    project_id: str | None = None


class ChatResponse(BaseModel):
    text: str
    thread_id: str | None = None
