from __future__ import annotations

from app.app_factory import create_service_app
from app.blueprint_routes import router as blueprint_router
from app.core.config import get_settings
from app.core.service_settings import build_service_settings_bundle
from app.services.blueprint.db import runtime as blueprint_db
from app.services.identity_project.db import runtime as identity_project_db

service_settings = build_service_settings_bundle(get_settings())

app = create_service_app(
    title="Deep Agents Blueprint API",
    router=blueprint_router,
    database_url=service_settings.blueprint.database_url,
    service_runtimes=(identity_project_db, blueprint_db),
)
