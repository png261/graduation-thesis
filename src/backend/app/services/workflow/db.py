from sqlalchemy.ext.asyncio import AsyncEngine

from app.core.config import get_settings
from app.core.service_settings import build_service_settings_bundle
from app.persistence.runtime import ServiceDatabaseRuntime
from app.services.workflow.models import ProjectJob


async def _schema_setup(engine: AsyncEngine) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(lambda sync_conn: ProjectJob.metadata.create_all(sync_conn, tables=[ProjectJob.__table__]))


runtime = ServiceDatabaseRuntime(
    lambda: build_service_settings_bundle(get_settings()).workflow.database_url,
    schema_setup=_schema_setup,
)

__all__ = ["runtime"]
