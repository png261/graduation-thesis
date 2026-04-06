from __future__ import annotations

from app.app_factory import create_service_app
from app.core.config import get_settings
from app.core.service_settings import build_service_settings_bundle
from app.provisioning_routes import router as provisioning_router

service_settings = build_service_settings_bundle(get_settings())

app = create_service_app(
    title="Deep Agents Provisioning API",
    router=provisioning_router,
    database_url=service_settings.provisioning.database_url,
)
