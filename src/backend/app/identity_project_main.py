from __future__ import annotations

from app.app_factory import create_service_app
from app.core.config import get_settings
from app.core.service_settings import build_service_settings_bundle
from app.identity_project_routes import router as identity_project_router
from app.services.identity_project.db import runtime as identity_project_db

service_settings = build_service_settings_bundle(get_settings())

app = create_service_app(
    title="Deep Agents Identity Project API",
    router=identity_project_router,
    database_url=service_settings.identity_project.database_url,
    service_runtimes=(identity_project_db,),
)
