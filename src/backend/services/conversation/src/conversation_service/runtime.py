from fastapi import APIRouter

from app.app_factory import create_service_app
from app.core.config import get_settings
from app.core.service_settings import build_service_settings_bundle
from app.shared.identity.runtime import runtime as identity_project_db

from . import api as conversation_service
from . import persistence as conversation_persistence
from .db import runtime as conversation_db

settings = get_settings()
service_settings = build_service_settings_bundle(settings)


def create_app(router: APIRouter):
    return create_service_app(
        title="Deep Agents Conversation API",
        router=router,
        database_url=service_settings.conversation_agent.database_url,
        service_runtimes=(identity_project_db, conversation_db),
    )


__all__ = [
    "conversation_persistence",
    "conversation_service",
    "create_app",
    "settings",
]
