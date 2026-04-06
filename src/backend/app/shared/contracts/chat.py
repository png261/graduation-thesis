from __future__ import annotations

from enum import Enum
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

_DOCUMENT_ATTACHMENT_EXTENSIONS = frozenset(
    {
        ".txt",
        ".md",
        ".json",
        ".yaml",
        ".yml",
        ".csv",
        ".xml",
        ".log",
        ".ini",
    }
)
_IMAGE_CONTENT_TYPES = frozenset({"image/png", "image/jpeg", "image/webp", "image/gif"})


class ChatRole(str, Enum):
    user = "user"
    assistant = "assistant"
    system = "system"


class ChatAttachment(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    type: Literal["document", "image"] = "document"
    name: str
    content: str
    content_type: str | None = Field(default=None, alias="contentType")
    size_bytes: int | None = Field(default=None, alias="sizeBytes")

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: str) -> str:
        name = value.strip()
        if not name:
            raise ValueError("attachment name is required")
        return name

    @field_validator("content")
    @classmethod
    def _validate_content(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("attachment content is required")
        return value

    @field_validator("content_type")
    @classmethod
    def _validate_content_type(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("size_bytes")
    @classmethod
    def _validate_size_bytes(cls, value: int | None) -> int | None:
        if value is None:
            return None
        if value < 0:
            raise ValueError("attachment size must be non-negative")
        return value

    @model_validator(mode="after")
    def _validate_type_specific_rules(self) -> "ChatAttachment":
        if self.type == "document":
            if Path(self.name).suffix.lower() not in _DOCUMENT_ATTACHMENT_EXTENSIONS:
                raise ValueError(f"unsupported attachment '{self.name}'")
            return self
        if self.content_type not in _IMAGE_CONTENT_TYPES:
            raise ValueError(f"unsupported image attachment '{self.name}'")
        if not self.content.startswith("data:image/"):
            raise ValueError(f"invalid image attachment '{self.name}'")
        return self


class ChatMessage(BaseModel):
    role: ChatRole = Field(..., description="user | assistant | system")
    content: str
    attachments: list[ChatAttachment] = Field(default_factory=list)

    @model_validator(mode="after")
    def _validate_attachments(self) -> ChatMessage:
        if self.role is not ChatRole.user and self.attachments:
            raise ValueError("attachments are only supported on user messages")
        return self


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    thread_id: str | None = None
    project_id: str | None = None


class ChatResponse(BaseModel):
    text: str
    thread_id: str | None = None
