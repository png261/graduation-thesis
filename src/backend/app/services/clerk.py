"""Clerk authentication and OAuth token helpers."""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import time
from typing import Any, Mapping

from clerk_backend_api import Clerk
from clerk_backend_api.models.oauthaccesstoken import OAuthAccessToken
from clerk_backend_api.security.types import AuthenticateRequestOptions

from app.core.config import Settings


class ClerkError(Exception):
    pass


@dataclass(slots=True)
class ClerkSession:
    user_id: str
    payload: dict[str, Any]


@dataclass(slots=True)
class ClerkOAuthToken:
    token: str
    provider_user_id: str | None
    expires_at: int | None
    scopes: list[str]


class _RequestHeaders:
    def __init__(self, headers: Mapping[str, str]) -> None:
        self._headers = headers

    @property
    def headers(self) -> Mapping[str, str]:
        return self._headers


@lru_cache(maxsize=1)
def _client(secret_key: str) -> Clerk:
    return Clerk(bearer_auth=secret_key)


def _options(settings: Settings) -> AuthenticateRequestOptions:
    audience = settings.clerk_audience_list()
    return AuthenticateRequestOptions(
        secret_key=settings.clerk_secret_key,
        jwt_key=settings.clerk_jwt_key or None,
        audience=audience if audience else None,
        authorized_parties=settings.clerk_authorized_parties_list() or None,
    )


def _require_secret_key(settings: Settings) -> str:
    if not settings.clerk_secret_key:
        raise ClerkError("CLERK_SECRET_KEY is not configured")
    return settings.clerk_secret_key


def authenticate_bearer(
    *,
    settings: Settings,
    headers: Mapping[str, str],
) -> ClerkSession | None:
    """Verify Clerk session token from Authorization header."""
    secret_key = _require_secret_key(settings)
    state = _client(secret_key).authenticate_request(
        request=_RequestHeaders(headers),
        options=_options(settings),
    )
    if not state.is_signed_in:
        return None

    payload: dict[str, Any] = state.payload if isinstance(state.payload, dict) else {}
    user_id = str(payload.get("sub") or "").strip()
    if not user_id:
        return None
    return ClerkSession(user_id=user_id, payload=payload)


def _latest_valid_token(tokens: list[OAuthAccessToken]) -> OAuthAccessToken | None:
    now = int(time.time())
    valid = [
        token
        for token in tokens
        if token.token and (token.expires_at is None or token.expires_at > now + 30)
    ]
    if not valid:
        return None
    valid.sort(key=lambda token: int(token.expires_at or 0), reverse=True)
    return valid[0]


def get_github_oauth_token(*, settings: Settings, user_id: str) -> ClerkOAuthToken | None:
    """Return latest valid GitHub OAuth token connected to Clerk user."""
    secret_key = _require_secret_key(settings)
    tokens = _client(secret_key).users.get_o_auth_access_token(
        user_id=user_id,
        provider="oauth_github",
        limit=10,
        offset=0,
    )
    latest = _latest_valid_token(tokens)
    if latest is None:
        return None
    return ClerkOAuthToken(
        token=latest.token,
        provider_user_id=latest.provider_user_id or None,
        expires_at=latest.expires_at,
        scopes=list(latest.scopes or []),
    )
