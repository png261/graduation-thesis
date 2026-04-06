from __future__ import annotations

from urllib.parse import SplitResult, urlsplit, urlunsplit

import psycopg
from psycopg import sql

from app.core.config import get_settings
from app.core.service_settings import build_service_settings_bundle
from app.services.blueprint.db import runtime as blueprint_db
from app.services.configuration_incident.db import runtime as configuration_incident_db
from app.services.conversation.db import runtime as conversation_db
from app.services.identity_project.db import runtime as identity_project_db
from app.services.workflow.db import runtime as workflow_db


def _admin_database_url(database_url: str) -> str:
    parsed = urlsplit(database_url)
    admin_path = "/postgres"
    rebuilt = SplitResult(
        scheme=parsed.scheme,
        netloc=parsed.netloc,
        path=admin_path,
        query=parsed.query,
        fragment=parsed.fragment,
    )
    return urlunsplit(rebuilt)


def _database_name(database_url: str) -> str:
    parsed = urlsplit(database_url)
    return (parsed.path or "/").lstrip("/")


def _ensure_database(database_url: str) -> None:
    database_name = _database_name(database_url)
    if not database_name:
        raise ValueError(f"Cannot derive database name from '{database_url}'")

    with psycopg.connect(_admin_database_url(database_url), autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (database_name,))
            if cur.fetchone() is not None:
                return
            cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database_name)))


async def main() -> int:
    settings = get_settings()
    if settings.service_database_mode.strip().lower() != "split":
        raise RuntimeError("Set SERVICE_DATABASE_MODE=split before bootstrapping service databases")

    service_settings = build_service_settings_bundle(settings)
    owned_databases = [
        service_settings.identity_project.database_url,
        service_settings.conversation_agent.database_url,
        service_settings.workflow.database_url,
        service_settings.blueprint.database_url,
        service_settings.configuration_incident.database_url,
    ]

    for database_url in owned_databases:
        _ensure_database(database_url)

    await identity_project_db.init(database_url=service_settings.identity_project.database_url)
    await workflow_db.init(database_url=service_settings.workflow.database_url)
    await blueprint_db.init(database_url=service_settings.blueprint.database_url)
    await configuration_incident_db.init(
        database_url=service_settings.configuration_incident.database_url
    )
    await conversation_db.init(database_url=service_settings.conversation_agent.database_url)

    await conversation_db.close()
    await configuration_incident_db.close()
    await blueprint_db.close()
    await workflow_db.close()
    await identity_project_db.close()
    return 0


if __name__ == "__main__":
    import asyncio

    raise SystemExit(asyncio.run(main()))
