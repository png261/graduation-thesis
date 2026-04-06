from sqlalchemy.ext.asyncio import AsyncEngine

from app.core.config import get_settings
from app.core.service_settings import build_service_settings_bundle
from app.persistence.runtime import ServiceDatabaseRuntime
from app.services.conversation.models import Thread, ThreadMessage

runtime = ServiceDatabaseRuntime(
    lambda: build_service_settings_bundle(get_settings()).conversation_agent.database_url,
    enable_checkpointer=True,
    schema_setup=lambda engine: _schema_setup(engine),
)


async def _schema_setup(engine: AsyncEngine) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(
            lambda sync_conn: Thread.metadata.create_all(sync_conn, tables=[Thread.__table__, ThreadMessage.__table__])
        )


__all__ = ["runtime"]
