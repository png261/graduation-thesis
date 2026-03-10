from __future__ import annotations

from typing import Any
from urllib.parse import urlencode

import httpx

from app.core.config import Settings

from .types import AuthError

GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_SCOPES = "repo read:user user:email"

APP_SESSION_COOKIE = "da_session"
OAUTH_STATE_COOKIE = "da_oauth_state"


def ensure_google_oauth_config(settings: Settings) -> None:
    if not settings.google_client_id or not settings.google_client_secret:
        raise AuthError("Google OAuth is not configured")


def ensure_github_oauth_config(settings: Settings) -> None:
    if not settings.github_client_id or not settings.github_client_secret:
        raise AuthError("GitHub OAuth is not configured")


def build_github_login_url(settings: Settings, state: str, *, redirect_uri: str) -> str:
    ensure_github_oauth_config(settings)
    params = {
        "client_id": settings.github_client_id,
        "redirect_uri": redirect_uri,
        "scope": GITHUB_SCOPES,
        "state": state,
    }
    return f"{GITHUB_AUTHORIZE_URL}?{urlencode(params)}"


async def exchange_github_code_for_token(
    settings: Settings,
    *,
    code: str,
    redirect_uri: str,
) -> dict[str, Any]:
    ensure_github_oauth_config(settings)
    payload = {
        "client_id": settings.github_client_id,
        "client_secret": settings.github_client_secret,
        "code": code,
        "redirect_uri": redirect_uri,
    }
    headers = {"Accept": "application/json"}
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(GITHUB_TOKEN_URL, data=payload, headers=headers)
    if response.status_code >= 400:
        raise AuthError(f"GitHub token exchange failed ({response.status_code})")
    data = response.json()
    if not isinstance(data, dict) or not data.get("access_token"):
        raise AuthError("GitHub did not return access token")
    if data.get("error"):
        raise AuthError(str(data.get("error_description") or data["error"]))
    return data


def build_google_login_url(settings: Settings, state: str) -> str:
    ensure_google_oauth_config(settings)
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_oauth_redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "offline",
        "prompt": "consent",
    }
    return f"{GOOGLE_AUTHORIZE_URL}?{urlencode(params)}"


async def exchange_google_code_for_token(settings: Settings, code: str) -> dict[str, Any]:
    ensure_google_oauth_config(settings)
    payload = {
        "client_id": settings.google_client_id,
        "client_secret": settings.google_client_secret,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": settings.google_oauth_redirect_uri,
    }
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(GOOGLE_TOKEN_URL, data=payload)
    if response.status_code >= 400:
        raise AuthError(f"Google token exchange failed ({response.status_code})")
    data = response.json()
    if not isinstance(data, dict) or not data.get("access_token"):
        raise AuthError("Google did not return access token")
    return data


async def google_get_user(access_token: str) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {access_token}"}
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(GOOGLE_USERINFO_URL, headers=headers)
    if response.status_code >= 400:
        raise AuthError(f"Google userinfo failed ({response.status_code})")
    data = response.json()
    if not isinstance(data, dict) or not data.get("sub"):
        raise AuthError("Invalid Google user payload")
    return data
