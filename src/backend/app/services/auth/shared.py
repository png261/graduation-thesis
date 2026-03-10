from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone
from typing import Any

from cryptography.fernet import Fernet


def cookie_kwargs() -> dict[str, Any]:
    return {
        "httponly": True,
        "secure": False,
        "samesite": "lax",
        "path": "/",
    }


def fernet_from_secret(secret: str, *, invalid_message: str, error_cls: type[Exception]) -> Fernet:
    try:
        if len(secret) == 44 and secret.endswith("="):
            return Fernet(secret.encode())
        padded = base64.urlsafe_b64encode(secret.encode().ljust(32, b"0")[:32])
        return Fernet(padded)
    except Exception as exc:  # pragma: no cover - defensive
        raise error_cls(invalid_message) from exc


def token_expiry_from_payload(payload: dict[str, Any]) -> datetime | None:
    expires_in = payload.get("expires_in")
    if expires_in is None:
        return None
    try:
        seconds = int(expires_in)
    except (TypeError, ValueError):
        return None
    return datetime.now(timezone.utc) + timedelta(seconds=max(0, seconds))
