"""Shared chat model and agent-store factory helpers."""

from __future__ import annotations

from contextlib import AsyncExitStack

from langchain_openai import ChatOpenAI
from langgraph.store.base import BaseStore
from langgraph.store.memory import InMemoryStore

from app.core.config import Settings

try:
    from langgraph.store.postgres.aio import AsyncPostgresStore
except ModuleNotFoundError:
    AsyncPostgresStore = None

_agent_store: BaseStore | None = None
_agent_store_stack: AsyncExitStack | None = None


def create_chat_model(settings: Settings) -> ChatOpenAI:
    """Create a chat model for the configured OpenAI-compatible endpoint."""
    return ChatOpenAI(
        api_key=settings.llm_api_key,
        base_url=settings.llm_base_url,
        model=settings.llm_model,
    )


async def get_agent_store(settings: Settings) -> BaseStore:
    """Return a process-scoped LangGraph store for agent memory."""
    global _agent_store, _agent_store_stack

    if _agent_store is not None:
        return _agent_store

    if AsyncPostgresStore is None:
        _agent_store = InMemoryStore()
        return _agent_store

    stack = AsyncExitStack()
    try:
        store = await stack.enter_async_context(
            AsyncPostgresStore.from_conn_string(settings.database_url),
        )
        await store.setup()
    except Exception:
        await stack.aclose()
        raise
    _agent_store = store
    _agent_store_stack = stack
    return _agent_store


async def close_agent_store() -> None:
    """Close the process-scoped agent store if it was initialized."""
    global _agent_store, _agent_store_stack

    if _agent_store_stack is not None:
        await _agent_store_stack.aclose()
    _agent_store = None
    _agent_store_stack = None
