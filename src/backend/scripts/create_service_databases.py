from __future__ import annotations

from urllib.parse import urlsplit, urlunsplit

from psycopg import connect
from psycopg.sql import SQL, Identifier

from app.core.config import Settings, get_settings
from app.core.service_settings import build_service_settings_bundle

SERVICE_NAMES = (
    "gateway",
    "identity_project",
    "conversation_agent",
    "workflow",
    "provisioning",
    "configuration_incident",
    "scm_integration",
)


def _database_name(database_url: str) -> str:
    parsed = urlsplit(database_url)
    path = parsed.path or ""
    return path.rsplit("/", 1)[-1]


def _admin_database_url(database_url: str) -> str:
    parsed = urlsplit(database_url)
    path = parsed.path or ""
    db_name = path.rsplit("/", 1)[-1]
    new_path = f"{path[: -len(db_name)]}postgres" if db_name else "/postgres"
    return urlunsplit((parsed.scheme, parsed.netloc, new_path, parsed.query, parsed.fragment))


def _service_database_urls(settings: Settings) -> dict[str, str]:
    bundle = build_service_settings_bundle(settings)
    return {
        "gateway": bundle.gateway.database_url,
        "identity_project": bundle.identity_project.database_url,
        "conversation_agent": bundle.conversation_agent.database_url,
        "workflow": bundle.workflow.database_url,
        "provisioning": bundle.provisioning.database_url,
        "configuration_incident": bundle.configuration_incident.database_url,
        "scm_integration": bundle.scm_integration.database_url,
    }


def _create_database_if_missing(admin_url: str, database_name: str) -> None:
    with connect(admin_url, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (database_name,))
            if cur.fetchone() is not None:
                print(f"exists: {database_name}")
                return
            cur.execute(SQL("CREATE DATABASE {}").format(Identifier(database_name)))
            print(f"created: {database_name}")


def main() -> int:
    settings = get_settings()
    if settings.service_database_mode.strip().lower() != "split":
        print("SERVICE_DATABASE_MODE is not 'split'; nothing to create.")
        return 0

    urls = _service_database_urls(settings)
    unique_urls = {url for url in urls.values()}
    for database_url in sorted(unique_urls):
        database_name = _database_name(database_url)
        if not database_name:
            print(f"skipped invalid database url: {database_url}")
            continue
        _create_database_if_missing(_admin_database_url(database_url), database_name)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
