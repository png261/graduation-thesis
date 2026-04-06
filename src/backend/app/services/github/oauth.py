from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone
from secrets import token_urlsafe
from urllib.parse import quote
from uuid import uuid4

import httpx
from sqlalchemy import select

from app import db
from app.core.config import Settings
from app.models import GitHubOAuthToken
from app.services.crypto import decrypt_text, encrypt_text
from app.services.github import auth as github_auth

DEFAULT_GITHUB_SCOPE = "repo read:user user:email"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _state_signature(secret: str, payload: str) -> str:
    digest = hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode("utf-8").rstrip("=")


def _state_payload(user_id: str) -> str:
    return json.dumps(
        {
            "user_id": user_id,
            "nonce": token_urlsafe(12),
            "issued_at": int(_now().timestamp()),
        },
        separators=(",", ":"),
    )


def build_oauth_state(*, user_id: str, settings: Settings) -> str:
    payload = _state_payload(user_id)
    encoded = base64.urlsafe_b64encode(payload.encode("utf-8")).decode("utf-8")
    signature = _state_signature(settings.state_encryption_key, encoded)
    return f"{encoded}.{signature}"


def parse_oauth_state(*, state: str, settings: Settings, max_age_minutes: int = 10) -> str:
    encoded, _, signature = (state or "").partition(".")
    if not encoded or not signature:
        raise ValueError("invalid_oauth_state")
    expected = _state_signature(settings.state_encryption_key, encoded)
    if not hmac.compare_digest(expected, signature):
        raise ValueError("invalid_oauth_state")
    try:
        raw = base64.urlsafe_b64decode(encoded.encode("utf-8") + b"=")
        payload = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise ValueError("invalid_oauth_state") from exc
    if not isinstance(payload, dict):
        raise ValueError("invalid_oauth_state")
    user_id = str(payload.get("user_id") or "").strip()
    issued_at = int(payload.get("issued_at") or 0)
    if not user_id or not issued_at:
        raise ValueError("invalid_oauth_state")
    expires_at = datetime.fromtimestamp(issued_at, tz=timezone.utc) + timedelta(minutes=max_age_minutes)
    if expires_at < _now():
        raise ValueError("oauth_state_expired")
    return user_id


def build_authorize_url(*, user_id: str, settings: Settings) -> str:
    if not settings.github_client_id or not settings.github_redirect_uri:
        raise ValueError("github_oauth_not_configured")
    state = build_oauth_state(user_id=user_id, settings=settings)
    return (
        f"{settings.github_oauth_authorize_url}?client_id={quote(settings.github_client_id, safe='')}"
        f"&redirect_uri={quote(settings.github_redirect_uri, safe='')}"
        f"&scope={quote(DEFAULT_GITHUB_SCOPE, safe='')}"
        f"&state={quote(state, safe='')}"
    )


async def exchange_code(*, code: str, settings: Settings) -> dict:
    if not settings.github_client_id or not settings.github_client_secret or not settings.github_redirect_uri:
        raise ValueError("github_oauth_not_configured")
    payload = {
        "client_id": settings.github_client_id,
        "client_secret": settings.github_client_secret,
        "code": code,
        "redirect_uri": settings.github_redirect_uri,
    }
    headers = {
        "Accept": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(settings.github_oauth_token_url, data=payload, headers=headers)
    if response.status_code >= 400:
        raise RuntimeError(response.text or "github_token_exchange_failed")
    data = response.json()
    if not isinstance(data, dict) or not data.get("access_token"):
        raise RuntimeError(str(data.get("error_description") or data.get("error") or "github_token_exchange_failed"))
    return data


async def fetch_github_user(access_token: str) -> dict:
    return await github_auth.github_get_user(access_token)


async def save_user_token(*, user_id: str, token_payload: dict, user_payload: dict, settings: Settings) -> None:
    expires_in = int(token_payload.get("expires_in") or 0)
    expires_at = _now() + timedelta(seconds=expires_in) if expires_in > 0 else None
    access_token = str(token_payload.get("access_token") or "")
    refresh_raw = str(token_payload.get("refresh_token") or "")
    encrypted_access = encrypt_text(secret=settings.state_encryption_key, value=access_token)
    encrypted_refresh = encrypt_text(secret=settings.state_encryption_key, value=refresh_raw) if refresh_raw else None

    async with db.get_session() as session:
        row = (
            await session.execute(select(GitHubOAuthToken).where(GitHubOAuthToken.user_id == user_id))
        ).scalar_one_or_none()
        if row is None:
            row = GitHubOAuthToken(
                id=str(uuid4()),
                user_id=user_id,
                access_token_encrypted=encrypted_access,
                refresh_token_encrypted=encrypted_refresh,
                expires_at=expires_at,
                scope=str(token_payload.get("scope") or DEFAULT_GITHUB_SCOPE),
                provider_user_id=str(user_payload.get("id") or ""),
                username=str(user_payload.get("login") or ""),
            )
            session.add(row)
        else:
            row.access_token_encrypted = encrypted_access
            row.refresh_token_encrypted = encrypted_refresh
            row.expires_at = expires_at
            row.scope = str(token_payload.get("scope") or DEFAULT_GITHUB_SCOPE)
            row.provider_user_id = str(user_payload.get("id") or "")
            row.username = str(user_payload.get("login") or "")
            row.updated_at = _now()


async def clear_user_token(*, user_id: str) -> None:
    async with db.get_session() as session:
        row = (
            await session.execute(select(GitHubOAuthToken).where(GitHubOAuthToken.user_id == user_id))
        ).scalar_one_or_none()
        if row is not None:
            await session.delete(row)


async def get_user_session(*, user_id: str, settings: Settings) -> dict:
    async with db.get_session() as session:
        row = (
            await session.execute(select(GitHubOAuthToken).where(GitHubOAuthToken.user_id == user_id))
        ).scalar_one_or_none()
    if row is None or (row.expires_at and row.expires_at <= _now()):
        return {"authenticated": False}
    return {
        "authenticated": True,
        "login": row.username,
        "provider_user_id": row.provider_user_id,
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
        "scope": row.scope or "",
    }


async def get_user_access_token(*, user_id: str, settings: Settings) -> str | None:
    async with db.get_session() as session:
        row = (
            await session.execute(select(GitHubOAuthToken).where(GitHubOAuthToken.user_id == user_id))
        ).scalar_one_or_none()
    if row is None or (row.expires_at and row.expires_at <= _now()):
        return None
    return decrypt_text(secret=settings.state_encryption_key, value=row.access_token_encrypted)
