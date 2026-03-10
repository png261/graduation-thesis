"""Shared chat model factory used by agent and OpenTofu selector."""
from __future__ import annotations

from langchain.chat_models import init_chat_model
from langchain_google_genai import ChatGoogleGenerativeAI

from app.core.config import Settings


_GEMINI_THINKING_PREFIXES = ("gemini-2.5",)


def create_chat_model(settings: Settings):
    """Create a chat model, disabling thinking for Gemini 2.5 series."""
    model_id = settings.gemini_model
    if any(
        model_id.startswith(prefix) or model_id.startswith(f"gemini:{prefix}")
        for prefix in _GEMINI_THINKING_PREFIXES
    ):
        raw_id = model_id.removeprefix("gemini:")
        return ChatGoogleGenerativeAI(model=raw_id, thinking_budget=0)
    return init_chat_model(model_id, model_provider="google_genai")
