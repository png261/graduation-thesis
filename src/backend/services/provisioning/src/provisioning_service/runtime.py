from fastapi import APIRouter

from app.app_factory import create_service_app
from app.core.config import get_settings
from app.core.service_settings import build_service_settings_bundle
from app.shared.identity import persistence as identity_project_persistence

from . import api as provisioning_service
from . import policy as execution_policy

settings = get_settings()
service_settings = build_service_settings_bundle(settings)


def create_app(router: APIRouter):
    return create_service_app(
        title="Deep Agents Provisioning API",
        router=router,
        database_url=service_settings.provisioning.database_url,
    )


__all__ = [
    "create_app",
    "execution_policy",
    "identity_project_persistence",
    "provisioning_service",
    "settings",
]
