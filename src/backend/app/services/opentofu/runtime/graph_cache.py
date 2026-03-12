from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any

from redis import Redis

from app.core.config import get_settings

_CACHE_TTL_SECONDS = 300.0
_GRAPH_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_redis_client: Redis | None = None
_redis_url: str | None = None
logger = logging.getLogger(__name__)


def _cache_ttl() -> int:
    return max(1, int(get_settings().runtime_cache_ttl_seconds))


def _cache_key(key: str) -> str:
    return f"cache:graph:{key}"


def _redis() -> Redis:
    global _redis_client, _redis_url
    settings = get_settings()
    if _redis_client is not None and _redis_url == settings.redis_url:
        return _redis_client
    _redis_client = Redis.from_url(settings.redis_url, decode_responses=True)
    _redis_url = settings.redis_url
    return _redis_client


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def cache_key(project_id: str, scope: str, graph_type: str) -> str:
    return f"{project_id}|{scope}|{graph_type}"


def cache_get(key: str) -> dict[str, Any] | None:
    try:
        raw = _redis().get(_cache_key(key))
    except Exception:
        raw = None
    if raw:
        try:
            payload = json.loads(raw)
            if isinstance(payload, dict):
                return payload
        except json.JSONDecodeError:
            logger.warning("invalid redis graph cache payload key=%s", key)
    entry = _GRAPH_CACHE.get(key)
    if entry is None:
        return None
    expires_at, payload = entry
    if time.time() >= expires_at:
        _GRAPH_CACHE.pop(key, None)
        return None
    return payload


def cache_set(key: str, payload: dict[str, Any]) -> None:
    try:
        _redis().set(_cache_key(key), json.dumps(payload, ensure_ascii=False), ex=_cache_ttl())
    except Exception:
        logger.exception("failed to store graph cache key=%s", key)
    _GRAPH_CACHE[key] = (time.time() + _CACHE_TTL_SECONDS, payload)
