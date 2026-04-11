from __future__ import annotations

from app.core.config import get_settings
from app.services.state_backends import service as state_service


async def sync_due_backends() -> dict:
    return await state_service.sync_due_backends(settings=get_settings())
