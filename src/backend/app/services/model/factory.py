"""Shared chat model factory used by agent and OpenTofu selector."""
from __future__ import annotations

from langchain_openai import ChatOpenAI

from app.core.config import Settings


def create_chat_model(settings: Settings) -> ChatOpenAI:
    """Create a chat model for the configured OpenAI-compatible endpoint."""
    return ChatOpenAI(
        api_key=settings.llm_api_key,
        base_url=settings.llm_base_url,
        model=settings.llm_model,
    )
