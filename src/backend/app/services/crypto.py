from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken


def _fernet(secret: str) -> Fernet:
    digest = hashlib.sha256((secret or "").encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_text(secret: str, value: str) -> str:
    return _fernet(secret).encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_text(secret: str, value: str) -> str | None:
    if not value:
        return None
    try:
        return _fernet(secret).decrypt(value.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        return None
