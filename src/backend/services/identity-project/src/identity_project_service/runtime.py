from fastapi import APIRouter

from app.app_factory import create_service_app
from app.core.config import get_settings
from app.core.service_settings import build_service_settings_bundle
from app.shared.blueprint import api as blueprint_service
from app.shared.conversation import persistence as conversation_persistence
from app.shared.conversation.runtime import runtime as shared_conversation_db
from app.shared.identity.runtime import runtime as shared_identity_db

from . import api as identity_project_service
from . import persistence as identity_project_persistence
from .db import runtime as identity_project_db

settings = get_settings()
service_settings = build_service_settings_bundle(settings)


def create_app(router: APIRouter):
    return create_service_app(
        title="Deep Agents Identity Project API",
        router=router,
        database_url=service_settings.identity_project.database_url,
        service_runtimes=(shared_identity_db, shared_conversation_db, identity_project_db),
    )


__all__ = [
    "blueprint_service",
    "conversation_persistence",
    "create_app",
    "identity_project_persistence",
    "identity_project_service",
    "settings",
    "shared_conversation_db",
    "shared_identity_db",
]
