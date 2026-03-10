from __future__ import annotations

from typing import Any
from urllib.parse import urlencode

import httpx

from app.core.config import Settings

from .auth_common import GITHUB_AUTHORIZE_URL, GITHUB_SCOPES, GITHUB_TOKEN_URL, GitHubAuthError
from .auth_crypto import ensure_oauth_config


def build_login_url(settings: Settings, state: str) -> str:
    ensure_oauth_config(settings)
    params = {
        "client_id": settings.github_client_id,
        "redirect_uri": settings.github_oauth_redirect_uri,
        "scope": GITHUB_SCOPES,
        "state": state,
    }
    return f"{GITHUB_AUTHORIZE_URL}?{urlencode(params)}"


async def exchange_code_for_token(settings: Settings, code: str) -> dict[str, Any]:
    ensure_oauth_config(settings)
    payload = {
        "client_id": settings.github_client_id,
        "client_secret": settings.github_client_secret,
        "code": code,
        "redirect_uri": settings.github_oauth_redirect_uri,
    }
    headers = {"Accept": "application/json"}
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(GITHUB_TOKEN_URL, data=payload, headers=headers)
    if response.status_code >= 400:
        raise GitHubAuthError(f"Token exchange failed ({response.status_code})")
    data = response.json()
    if "error" in data:
        raise GitHubAuthError(str(data.get("error_description") or data["error"]))
    access_token = data.get("access_token")
    if not access_token:
        raise GitHubAuthError("GitHub did not return access_token")
    return data


async def refresh_access_token(settings: Settings, refresh_token: str) -> dict[str, Any]:
    payload = {
        "client_id": settings.github_client_id,
        "client_secret": settings.github_client_secret,
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    }
    headers = {"Accept": "application/json"}
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(GITHUB_TOKEN_URL, data=payload, headers=headers)
    if response.status_code >= 400:
        raise GitHubAuthError(f"Token refresh failed ({response.status_code})")
    data = response.json()
    if "error" in data:
        raise GitHubAuthError(str(data.get("error_description") or data["error"]))
    if not data.get("access_token"):
        raise GitHubAuthError("Token refresh did not return access token")
    return data
