from __future__ import annotations

from app.app_factory import create_service_app
from app.configuration_incident_routes import router as configuration_incident_router
from app.core.config import get_settings
from app.core.service_settings import build_service_settings_bundle
from app.services.configuration_incident.db import runtime as configuration_incident_db
from app.services.identity_project.db import runtime as identity_project_db

service_settings = build_service_settings_bundle(get_settings())

app = create_service_app(
    title="Deep Agents Configuration Incident API",
    router=configuration_incident_router,
    database_url=service_settings.configuration_incident.database_url,
    service_runtimes=(identity_project_db, configuration_incident_db),
)
