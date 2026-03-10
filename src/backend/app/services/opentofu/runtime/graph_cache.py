from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

_CACHE_TTL_SECONDS = 300.0
_GRAPH_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def cache_key(project_id: str, scope: str, graph_type: str) -> str:
    return f"{project_id}|{scope}|{graph_type}"


def cache_get(key: str) -> dict[str, Any] | None:
    entry = _GRAPH_CACHE.get(key)
    if entry is None:
        return None
    expires_at, payload = entry
    if time.time() >= expires_at:
        _GRAPH_CACHE.pop(key, None)
        return None
    return payload


def cache_set(key: str, payload: dict[str, Any]) -> None:
    _GRAPH_CACHE[key] = (time.time() + _CACHE_TTL_SECONDS, payload)
