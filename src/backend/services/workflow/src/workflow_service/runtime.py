from fastapi import APIRouter

from app.app_factory import create_service_app
from app.core.config import get_settings
from app.core.service_settings import build_service_settings_bundle
from app.shared.identity import persistence as identity_project_persistence
from app.shared.identity.runtime import runtime as identity_project_db

settings = get_settings()
service_settings = build_service_settings_bundle(settings)


def create_app(router: APIRouter):
    return create_service_app(
        title="Deep Agents Workflow API",
        router=router,
        database_url=service_settings.workflow.database_url,
        service_runtimes=(identity_project_db,),
    )


__all__ = [
    "create_app",
    "identity_project_persistence",
    "settings",
]
