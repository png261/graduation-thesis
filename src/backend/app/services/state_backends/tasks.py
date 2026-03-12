from __future__ import annotations

import asyncio

from app import db
from app.celery_app import celery_app
from app.core.config import get_settings
from app.services.state_backends import service as state_service

_db_ready = False


def _run(coro):
    return asyncio.run(coro)


async def _ensure_db() -> None:
    global _db_ready
    if _db_ready:
        return
    settings = get_settings()
    await db.init_db(settings.database_url)
    _db_ready = True


@celery_app.task(name="state_backends.sync_due", max_retries=0)
def sync_due_backends() -> dict:
    async def runner() -> dict:
        await _ensure_db()
        return await state_service.sync_due_backends(settings=get_settings())

    return _run(runner())
