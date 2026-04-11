from fastapi import APIRouter

from app.app_factory import create_service_app
from app.core.config import get_settings
from app.core.service_settings import build_service_settings_bundle
from app.shared.identity import persistence as identity_project_persistence
from app.shared.identity.runtime import runtime as identity_project_db

from . import api as configuration_incident_service
from .db import runtime as configuration_incident_db

settings = get_settings()
service_settings = build_service_settings_bundle(settings)


def create_app(router: APIRouter):
    return create_service_app(
        title="Deep Agents Configuration Incident API",
        router=router,
        database_url=service_settings.configuration_incident.database_url,
        service_runtimes=(identity_project_db, configuration_incident_db),
    )


__all__ = [
    "configuration_incident_service",
    "create_app",
    "identity_project_persistence",
    "settings",
]
