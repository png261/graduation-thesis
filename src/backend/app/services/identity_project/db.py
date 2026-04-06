from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.core.config import get_settings
from app.core.service_settings import build_service_settings_bundle
from app.persistence.runtime import ServiceDatabaseRuntime
from app.services.identity_project.models import Project, User

_LEGACY_PROJECT_COLUMN_PATCHES = (
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS provider VARCHAR",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS credentials TEXT",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS active_blueprints_json JSON",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS user_id VARCHAR",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_repo_full_name VARCHAR",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_repository_id VARCHAR",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_repository_owner VARCHAR",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_base_branch VARCHAR",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_working_branch VARCHAR",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_installation_id VARCHAR",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_installation_account_id VARCHAR",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_installation_account_login VARCHAR",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_installation_target_type VARCHAR",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_permissions_json JSON",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_connected_at TIMESTAMPTZ",
)


async def _schema_setup(engine: AsyncEngine) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(
            lambda sync_conn: User.metadata.create_all(
                sync_conn,
                tables=[User.__table__, Project.__table__],
            )
        )
        for statement in _LEGACY_PROJECT_COLUMN_PATCHES:
            await conn.execute(text(statement))


runtime = ServiceDatabaseRuntime(
    lambda: build_service_settings_bundle(get_settings()).identity_project.database_url,
    schema_setup=_schema_setup,
)

__all__ = ["runtime"]
