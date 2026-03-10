from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from cryptography.fernet import InvalidToken

from app.core.config import Settings

from app.services.auth.shared import fernet_from_secret, token_expiry_from_payload as _token_expiry
from .auth_common import GitHubAuthError


def ensure_oauth_config(settings: Settings) -> None:
    if not settings.github_client_id or not settings.github_client_secret:
        raise GitHubAuthError("GitHub OAuth is not configured")
    if not settings.github_token_encryption_key:
        raise GitHubAuthError("GITHUB_TOKEN_ENCRYPTION_KEY is not configured")


def encrypt_token(settings: Settings, token: str | None) -> str | None:
    if not token:
        return None
    key = settings.github_token_encryption_key or ""
    fernet = fernet_from_secret(
        key,
        invalid_message="Invalid GITHUB_TOKEN_ENCRYPTION_KEY",
        error_cls=GitHubAuthError,
    )
    return fernet.encrypt(token.encode()).decode()


def decrypt_token(settings: Settings, encrypted: str | None) -> str | None:
    if not encrypted:
        return None
    key = settings.github_token_encryption_key or ""
    fernet = fernet_from_secret(
        key,
        invalid_message="Invalid GITHUB_TOKEN_ENCRYPTION_KEY",
        error_cls=GitHubAuthError,
    )
    try:
        return fernet.decrypt(encrypted.encode()).decode()
    except InvalidToken as exc:
        raise GitHubAuthError("Failed to decrypt GitHub token") from exc


def token_expiry_from_payload(payload: dict[str, Any]) -> datetime | None:
    return _token_expiry(payload)


def token_refresh_is_due(expires_at: datetime | None) -> bool:
    if expires_at is None:
        return False
    return expires_at <= datetime.now(timezone.utc) + timedelta(minutes=1)
