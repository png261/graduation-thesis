from __future__ import annotations

import base64
import hashlib
import json

from cryptography.fernet import Fernet, InvalidToken

_ENC_PREFIX = "enc:v1:"


def _fernet(secret: str) -> Fernet:
    digest = hashlib.sha256(secret.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_text(*, secret: str, value: str) -> str:
    token = _fernet(secret).encrypt(value.encode("utf-8")).decode("utf-8")
    return f"{_ENC_PREFIX}{token}"


def decrypt_text(*, secret: str, value: str) -> str:
    if not value:
        return ""
    if not value.startswith(_ENC_PREFIX):
        return value
    payload = value[len(_ENC_PREFIX) :]
    try:
        return _fernet(secret).decrypt(payload.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise ValueError("invalid_encrypted_payload") from exc


def encrypt_json(*, secret: str, payload: dict[str, str]) -> str:
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    return encrypt_text(secret=secret, value=raw)


def decrypt_json(*, secret: str, value: str | None) -> dict[str, str]:
    if not value:
        return {}
    raw = decrypt_text(secret=secret, value=value)
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("invalid_encrypted_json") from exc
    if not isinstance(parsed, dict):
        raise ValueError("invalid_encrypted_json_shape")
    return {str(key): str(val) for key, val in parsed.items() if val is not None}
