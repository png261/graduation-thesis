from fastapi import APIRouter

from app.app_factory import create_service_app
from app.core.config import get_settings
from app.core.service_settings import build_service_settings_bundle

service_settings = build_service_settings_bundle(get_settings())


def create_app(router: APIRouter):
    return create_service_app(
        title="Deep Agents API",
        router=router,
        database_url=service_settings.gateway.database_url,
        enable_cors=True,
    )


__all__ = ["create_app"]
