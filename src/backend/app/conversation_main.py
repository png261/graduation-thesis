from __future__ import annotations

from app.app_factory import create_service_app
from app.conversation_routes import router as conversation_router
from app.core.config import get_settings
from app.core.service_settings import build_service_settings_bundle
from app.services.conversation.db import runtime as conversation_db
from app.services.identity_project.db import runtime as identity_project_db

service_settings = build_service_settings_bundle(get_settings())

app = create_service_app(
    title="Deep Agents Conversation API",
    router=conversation_router,
    database_url=service_settings.conversation_agent.database_url,
    service_runtimes=(identity_project_db, conversation_db),
)
