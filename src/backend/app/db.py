"""Database initialisation: AsyncPostgresSaver (checkpoints) + SQLAlchemy ORM."""
from __future__ import annotations

from contextlib import AsyncExitStack, asynccontextmanager
from typing import AsyncGenerator

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.models import Base

_saver: AsyncPostgresSaver | None = None
_engine: AsyncEngine | None = None
_AsyncSession: async_sessionmaker[AsyncSession] | None = None
_exit_stack: AsyncExitStack | None = None
_LEGACY_PROJECT_COLUMN_PATCHES = (
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS provider VARCHAR",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS credentials TEXT",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS active_blueprints_json JSON",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS user_id VARCHAR",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_repo_full_name VARCHAR",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_base_branch VARCHAR",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_working_branch VARCHAR",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_connected_at TIMESTAMPTZ",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS telegram_chat_id VARCHAR",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS telegram_topic_id VARCHAR",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS telegram_topic_title VARCHAR",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS telegram_connected_at TIMESTAMPTZ",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS telegram_pending_code_hash VARCHAR",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS telegram_pending_expires_at TIMESTAMPTZ",
)


def _sqla_url(conn_string: str) -> str:
    """Convert a plain PostgreSQL URL to the SQLAlchemy+psycopg async dialect."""
    for prefix in ("postgresql://", "postgres://"):
        if conn_string.startswith(prefix):
            return "postgresql+psycopg" + conn_string[len(prefix) - 3:]
    # Already has a dialect (e.g. postgresql+psycopg://...)
    return conn_string


async def _create_orm_schema(conn: AsyncConnection) -> None:
    await conn.run_sync(Base.metadata.create_all)


async def _apply_legacy_project_column_patches(conn: AsyncConnection) -> None:
    for stmt in _LEGACY_PROJECT_COLUMN_PATCHES:
        await conn.execute(text(stmt))


async def init_db(
    conn_string: str,
    *,
    run_setup: bool = True,
    run_schema_setup: bool = True,
) -> None:
    """Open all connections, run LangGraph migrations, and create ORM tables."""
    global _saver, _engine, _AsyncSession, _exit_stack

    stack = AsyncExitStack()
    _exit_stack = stack

    # LangGraph checkpointer — conversation history keyed by thread_id
    _saver = await stack.enter_async_context(
        AsyncPostgresSaver.from_conn_string(conn_string)
    )
    if run_setup:
        await _saver.setup()

    # SQLAlchemy async engine — projects / threads ORM tables
    _engine = create_async_engine(_sqla_url(conn_string), echo=False)
    _AsyncSession = async_sessionmaker(_engine, expire_on_commit=False)

    if run_schema_setup:
        async with _engine.begin() as conn:
            await _create_orm_schema(conn)
            # Compatibility path for old databases created before new Project columns.
            await _apply_legacy_project_column_patches(conn)



async def close_db() -> None:
    """Close all connections."""
    if _engine:
        await _engine.dispose()
    if _exit_stack:
        await _exit_stack.aclose()


def get_checkpointer() -> AsyncPostgresSaver:
    if _saver is None:
        raise RuntimeError("Database not initialised — call init_db() first")
    return _saver


@asynccontextmanager
async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Async context manager that yields a SQLAlchemy session."""
    if _AsyncSession is None:
        raise RuntimeError("Database not initialised — call init_db() first")
    async with _AsyncSession() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
