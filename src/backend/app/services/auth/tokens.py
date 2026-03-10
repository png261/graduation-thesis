from __future__ import annotations

from app.core.config import Settings

from .shared import fernet_from_secret
from .types import AuthError


def _token_secret(settings: Settings) -> str:
    return settings.auth_token_encryption_key or settings.github_token_encryption_key or ""


def encrypt_token(settings: Settings, token: str | None) -> str | None:
    if not token:
        return None
    secret = _token_secret(settings)
    if not secret:
        raise AuthError("AUTH_TOKEN_ENCRYPTION_KEY or GITHUB_TOKEN_ENCRYPTION_KEY is required")
    fernet = fernet_from_secret(
        secret,
        invalid_message="Invalid token encryption key",
        error_cls=AuthError,
    )
    return fernet.encrypt(token.encode()).decode()
