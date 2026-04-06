from fastapi import APIRouter

from app.app_factory import create_service_app
from app.core.config import get_settings
from app.core.service_settings import build_service_settings_bundle
from app.shared.identity import persistence as identity_project_persistence
from app.shared.identity.runtime import runtime as identity_project_db

from . import api as blueprint_service
from . import persistence as blueprint_persistence
from .db import runtime as blueprint_db
from .types import BlueprintKind

service_settings = build_service_settings_bundle(get_settings())


def create_app(router: APIRouter):
    return create_service_app(
        title="Deep Agents Blueprint API",
        router=router,
        database_url=service_settings.blueprint.database_url,
        service_runtimes=(identity_project_db, blueprint_db),
    )


__all__ = [
    "BlueprintKind",
    "blueprint_persistence",
    "blueprint_service",
    "create_app",
    "identity_project_persistence",
]
