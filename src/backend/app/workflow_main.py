from __future__ import annotations

from app.app_factory import create_service_app
from app.core.config import get_settings
from app.core.service_settings import build_service_settings_bundle
from app.services.identity_project.db import runtime as identity_project_db
from app.workflow_routes import router as workflow_router

service_settings = build_service_settings_bundle(get_settings())

app = create_service_app(
    title="Deep Agents Workflow API",
    router=workflow_router,
    database_url=service_settings.workflow.database_url,
    service_runtimes=(identity_project_db,),
)
