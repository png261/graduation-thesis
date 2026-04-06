from fastapi import APIRouter

from app.app_factory import create_service_app
from app.core.config import get_settings
from app.core.service_settings import build_service_settings_bundle
from app.shared.identity import api as identity_project_service
from app.shared.identity import persistence as identity_project_persistence

from . import api as scm_service

settings = get_settings()
service_settings = build_service_settings_bundle(settings)


def create_app(router: APIRouter):
    return create_service_app(
        title="Deep Agents SCM API",
        router=router,
        database_url=service_settings.scm_integration.database_url,
    )


__all__ = [
    "create_app",
    "identity_project_persistence",
    "identity_project_service",
    "scm_service",
    "settings",
]
