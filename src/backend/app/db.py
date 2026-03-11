"""Database initialisation: AsyncPostgresSaver (checkpoints) + SQLAlchemy ORM."""
from __future__ import annotations

from contextlib import AsyncExitStack, asynccontextmanager
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from app.models import Base

_saver: AsyncPostgresSaver | None = None
_engine: AsyncEngine | None = None
_AsyncSession: async_sessionmaker[AsyncSession] | None = None
_exit_stack: AsyncExitStack | None = None


def _sqla_url(conn_string: str) -> str:
    """Convert a plain PostgreSQL URL to the SQLAlchemy+psycopg async dialect."""
    for prefix in ("postgresql://", "postgres://"):
        if conn_string.startswith(prefix):
            return "postgresql+psycopg" + conn_string[len(prefix) - 3:]
    # Already has a dialect (e.g. postgresql+psycopg://...)
    return conn_string


async def init_db(conn_string: str) -> None:
    """Open all connections, run LangGraph migrations, and create ORM tables."""
    global _saver, _engine, _AsyncSession, _exit_stack

    stack = AsyncExitStack()
    _exit_stack = stack

    # LangGraph checkpointer — conversation history keyed by thread_id
    _saver = await stack.enter_async_context(
        AsyncPostgresSaver.from_conn_string(conn_string)
    )
    await _saver.setup()

    # SQLAlchemy async engine — projects / threads ORM tables
    _engine = create_async_engine(_sqla_url(conn_string), echo=False)
    _AsyncSession = async_sessionmaker(_engine, expire_on_commit=False)

    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Add columns introduced after initial schema creation (idempotent).
        for stmt in (
            "ALTER TABLE projects ADD COLUMN IF NOT EXISTS provider VARCHAR",
            "ALTER TABLE projects ADD COLUMN IF NOT EXISTS credentials TEXT",
            "ALTER TABLE projects ADD COLUMN IF NOT EXISTS user_id VARCHAR",
            "ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_repo_full_name VARCHAR",
            "ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_base_branch VARCHAR",
            "ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_working_branch VARCHAR",
            "ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_connected_at TIMESTAMPTZ",
        ):
            await conn.execute(__import__("sqlalchemy").text(stmt))



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
