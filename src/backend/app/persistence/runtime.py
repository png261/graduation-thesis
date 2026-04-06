from __future__ import annotations

from contextlib import AsyncExitStack, asynccontextmanager
from typing import AsyncGenerator, Awaitable, Callable

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import InMemorySaver
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

try:
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
except ModuleNotFoundError:
    AsyncPostgresSaver = None


def _sqla_url(conn_string: str) -> str:
    for prefix in ("postgresql://", "postgres://"):
        if conn_string.startswith(prefix):
            return "postgresql+psycopg" + conn_string[len(prefix) - 3 :]
    return conn_string


class ServiceDatabaseRuntime:
    def __init__(
        self,
        database_url_factory: Callable[[], str],
        *,
        enable_checkpointer: bool = False,
        schema_setup: Callable[[AsyncEngine], Awaitable[None]] | None = None,
    ) -> None:
        self._database_url_factory = database_url_factory
        self._database_url_override: str | None = None
        self._session_factory: async_sessionmaker[AsyncSession] | None = None
        self._engine: AsyncEngine | None = None
        self._enable_checkpointer = enable_checkpointer
        self._schema_setup = schema_setup
        self._checkpointer: BaseCheckpointSaver | None = None
        self._exit_stack: AsyncExitStack | None = None

    def _database_url(self) -> str:
        return self._database_url_override or self._database_url_factory()

    async def init(
        self,
        *,
        database_url: str | None = None,
        run_checkpointer_setup: bool = True,
        run_schema_setup: bool = True,
    ) -> None:
        if database_url is not None:
            self._database_url_override = database_url
        if self._session_factory is not None:
            return
        if self._enable_checkpointer:
            stack = AsyncExitStack()
            self._exit_stack = stack
            if AsyncPostgresSaver is None:
                self._checkpointer = await stack.enter_async_context(InMemorySaver())
            else:
                saver = await stack.enter_async_context(AsyncPostgresSaver.from_conn_string(self._database_url()))
                if run_checkpointer_setup:
                    await saver.setup()
                self._checkpointer = saver
        self._engine = create_async_engine(_sqla_url(self._database_url()), echo=False)
        if self._schema_setup is not None and run_schema_setup:
            await self._schema_setup(self._engine)
        self._session_factory = async_sessionmaker(self._engine, expire_on_commit=False)

    async def close(self) -> None:
        if self._engine is not None:
            await self._engine.dispose()
        if self._exit_stack is not None:
            await self._exit_stack.aclose()
        self._engine = None
        self._session_factory = None
        self._checkpointer = None
        self._exit_stack = None
        self._database_url_override = None

    @asynccontextmanager
    async def get_session(self) -> AsyncGenerator[AsyncSession, None]:
        if self._session_factory is None:
            raise RuntimeError("Service database runtime is not initialised")
        async with self._session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    def get_checkpointer(self) -> BaseCheckpointSaver:
        if self._checkpointer is None:
            raise RuntimeError("Service database runtime checkpointer is not initialised")
        return self._checkpointer
