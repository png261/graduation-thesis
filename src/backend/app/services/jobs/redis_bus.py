from __future__ import annotations

import json
import logging
from typing import Any

from redis.asyncio import Redis

from app.core.config import Settings

logger = logging.getLogger(__name__)

_redis_client: Redis | None = None
_redis_url: str | None = None


def _events_key(job_id: str) -> str:
    return f"jobs:{job_id}:events"


def _seq_key(job_id: str) -> str:
    return f"jobs:{job_id}:seq"


def events_channel(job_id: str) -> str:
    return f"jobs:{job_id}:channel"


def _cache_key(namespace: str, key: str) -> str:
    return f"cache:{namespace}:{key}"


async def get_redis(settings: Settings) -> Redis:
    global _redis_client, _redis_url
    if _redis_client is not None and _redis_url == settings.redis_url:
        return _redis_client
    client = Redis.from_url(settings.redis_url, decode_responses=True)
    await client.ping()
    _redis_client = client
    _redis_url = settings.redis_url
    return client


async def close_redis() -> None:
    global _redis_client, _redis_url
    if _redis_client is None:
        return
    await _redis_client.aclose()
    _redis_client = None
    _redis_url = None


async def publish_job_event(
    *,
    settings: Settings,
    job_id: str,
    event: dict[str, Any],
) -> dict[str, Any]:
    try:
        redis = await get_redis(settings)
        seq = int(await redis.incr(_seq_key(job_id)))
        record = {"seq": seq, **event}
        payload = json.dumps(record, ensure_ascii=False)
        pipe = redis.pipeline()
        pipe.rpush(_events_key(job_id), payload)
        pipe.publish(events_channel(job_id), payload)
        pipe.expire(_events_key(job_id), settings.jobs_event_ttl_seconds)
        pipe.expire(_seq_key(job_id), settings.jobs_event_ttl_seconds)
        await pipe.execute()
        return record
    except Exception:
        logger.exception("failed to publish job event %s", job_id)
        return dict(event)


async def load_replay_events(
    *,
    settings: Settings,
    job_id: str,
    from_seq: int,
) -> list[dict[str, Any]]:
    try:
        redis = await get_redis(settings)
        raw = await redis.lrange(_events_key(job_id), 0, -1)
    except Exception:
        logger.exception("failed to load replay events %s", job_id)
        return []
    result: list[dict[str, Any]] = []
    for value in raw:
        try:
            row = json.loads(value)
        except json.JSONDecodeError:
            continue
        seq = int(row.get("seq", 0) or 0)
        if seq <= from_seq:
            continue
        result.append(row)
    return result


async def cache_get_json(*, settings: Settings, namespace: str, key: str) -> dict[str, Any] | None:
    try:
        redis = await get_redis(settings)
        raw = await redis.get(_cache_key(namespace, key))
        if not raw:
            return None
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except Exception:
        logger.exception("cache get failed namespace=%s key=%s", namespace, key)
        return None


async def cache_set_json(
    *,
    settings: Settings,
    namespace: str,
    key: str,
    payload: dict[str, Any],
    ttl_seconds: int | None = None,
) -> None:
    ttl = ttl_seconds or settings.runtime_cache_ttl_seconds
    try:
        redis = await get_redis(settings)
        raw = json.dumps(payload, ensure_ascii=False)
        await redis.set(_cache_key(namespace, key), raw, ex=max(1, ttl))
    except Exception:
        logger.exception("cache set failed namespace=%s key=%s", namespace, key)
