from __future__ import annotations

import base64
import hashlib
import hmac
import json
import asyncio
from datetime import datetime, timedelta, timezone
from secrets import token_urlsafe
from urllib.parse import quote
from uuid import uuid4

import httpx
from sqlalchemy import select

from app import db
from app.core.config import Settings
from app.models import GitLabOAuthToken

from .crypto import decrypt_text, encrypt_text


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
    sig = _state_signature(settings.state_encryption_key, encoded)
    return f"{encoded}.{sig}"


def parse_oauth_state(*, state: str, settings: Settings, max_age_minutes: int = 10) -> str:
    encoded, _, sig = (state or "").partition(".")
    if not encoded or not sig:
        raise ValueError("invalid_oauth_state")
    expected = _state_signature(settings.state_encryption_key, encoded)
    if not hmac.compare_digest(expected, sig):
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
    if datetime.fromtimestamp(issued_at, tz=timezone.utc) < _now() - timedelta(minutes=max_age_minutes):
        raise ValueError("oauth_state_expired")
    return user_id


def build_authorize_url(*, user_id: str, settings: Settings) -> str:
    if not settings.gitlab_client_id or not settings.gitlab_redirect_uri:
        raise ValueError("gitlab_oauth_not_configured")
    state = build_oauth_state(user_id=user_id, settings=settings)
    scopes = quote("read_user read_api")
    redirect_uri = quote(settings.gitlab_redirect_uri, safe="")
    return (
        f"{settings.gitlab_oauth_authorize_url}?response_type=code"
        f"&client_id={quote(settings.gitlab_client_id, safe='')}"
        f"&redirect_uri={redirect_uri}"
        f"&scope={scopes}"
        f"&state={quote(state, safe='')}"
    )


async def exchange_code(*, code: str, settings: Settings) -> dict:
    if not settings.gitlab_client_id or not settings.gitlab_client_secret or not settings.gitlab_redirect_uri:
        raise ValueError("gitlab_oauth_not_configured")
    payload = {
        "grant_type": "authorization_code",
        "client_id": settings.gitlab_client_id,
        "client_secret": settings.gitlab_client_secret,
        "code": code,
        "redirect_uri": settings.gitlab_redirect_uri,
    }
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.post(settings.gitlab_oauth_token_url, data=payload)
    if res.status_code >= 400:
        raise RuntimeError(res.text or "gitlab_token_exchange_failed")
    data = res.json()
    if not isinstance(data, dict) or not data.get("access_token"):
        raise RuntimeError("gitlab_token_exchange_failed")
    return data


async def fetch_gitlab_user(access_token: str, settings: Settings) -> dict:
    def _load_user() -> dict:
        try:
            import gitlab
        except Exception as exc:  # pragma: no cover - import failure path
            raise RuntimeError("gitlab_sdk_unavailable") from exc
        try:
            client = gitlab.Gitlab(settings.gitlab_api_url, oauth_token=access_token, per_page=100)
            client.auth()
            user = getattr(client, "user", None)
            if user is None:
                raise RuntimeError("gitlab_user_failed")
            payload = getattr(user, "attributes", None)
            if not isinstance(payload, dict):
                raise RuntimeError("gitlab_user_failed")
            return payload
        except Exception as exc:
            raise RuntimeError(str(exc) or "gitlab_user_failed") from exc

    return await asyncio.to_thread(_load_user)


async def save_user_token(*, user_id: str, token_payload: dict, user_payload: dict, settings: Settings) -> None:
    expires_in = int(token_payload.get("expires_in") or 0)
    expires_at = _now() + timedelta(seconds=expires_in) if expires_in > 0 else None
    encrypted_access = encrypt_text(secret=settings.state_encryption_key, value=str(token_payload.get("access_token") or ""))
    refresh_raw = str(token_payload.get("refresh_token") or "")
    encrypted_refresh = encrypt_text(secret=settings.state_encryption_key, value=refresh_raw) if refresh_raw else None

    async with db.get_session() as session:
        rows = await session.execute(select(GitLabOAuthToken).where(GitLabOAuthToken.user_id == user_id))
        row = rows.scalar_one_or_none()
        if row is None:
            row = GitLabOAuthToken(
                id=str(uuid4()),
                user_id=user_id,
                access_token_encrypted=encrypted_access,
                refresh_token_encrypted=encrypted_refresh,
                expires_at=expires_at,
                scope=str(token_payload.get("scope") or ""),
                provider_user_id=str(user_payload.get("id") or ""),
                username=str(user_payload.get("username") or ""),
            )
            session.add(row)
        else:
            row.access_token_encrypted = encrypted_access
            row.refresh_token_encrypted = encrypted_refresh
            row.expires_at = expires_at
            row.scope = str(token_payload.get("scope") or "")
            row.provider_user_id = str(user_payload.get("id") or "")
            row.username = str(user_payload.get("username") or "")
            row.updated_at = _now()


async def clear_user_token(*, user_id: str) -> None:
    async with db.get_session() as session:
        rows = await session.execute(select(GitLabOAuthToken).where(GitLabOAuthToken.user_id == user_id))
        row = rows.scalar_one_or_none()
        if row is None:
            return
        await session.delete(row)


async def get_user_session(*, user_id: str, settings: Settings) -> dict:
    async with db.get_session() as session:
        rows = await session.execute(select(GitLabOAuthToken).where(GitLabOAuthToken.user_id == user_id))
        row = rows.scalar_one_or_none()
    if row is None:
        return {"authenticated": False}
    if row.expires_at and row.expires_at <= _now():
        return {"authenticated": False}
    return {
        "authenticated": True,
        "login": row.username,
        "provider_user_id": row.provider_user_id,
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
    }


async def get_user_access_token(*, user_id: str, settings: Settings) -> str | None:
    async with db.get_session() as session:
        rows = await session.execute(select(GitLabOAuthToken).where(GitLabOAuthToken.user_id == user_id))
        row = rows.scalar_one_or_none()
    if row is None:
        return None
    if row.expires_at and row.expires_at <= _now():
        return None
    return decrypt_text(secret=settings.state_encryption_key, value=row.access_token_encrypted)


async def list_repositories(*, access_token: str, settings: Settings) -> list[dict]:
    def _list_projects() -> list[dict]:
        try:
            import gitlab
        except Exception as exc:  # pragma: no cover - import failure path
            raise RuntimeError("gitlab_sdk_unavailable") from exc
        try:
            client = gitlab.Gitlab(settings.gitlab_api_url, oauth_token=access_token, per_page=100)
            client.auth()
            rows = client.projects.list(
                membership=True,
                simple=True,
                order_by="last_activity_at",
                all=True,
            )
        except Exception as exc:
            raise RuntimeError(str(exc) or "gitlab_repos_failed") from exc
        repos: list[dict] = []
        for row in rows:
            payload = getattr(row, "attributes", None)
            if not isinstance(payload, dict):
                continue
            namespace = payload.get("namespace") if isinstance(payload.get("namespace"), dict) else {}
            repos.append(
                {
                    "id": payload.get("id"),
                    "name": payload.get("name"),
                    "full_name": payload.get("path_with_namespace"),
                    "private": str(payload.get("visibility") or "private") != "public",
                    "default_branch": payload.get("default_branch") or "main",
                    "owner_login": namespace.get("full_path"),
                }
            )
        repos.sort(key=lambda item: str(item.get("full_name") or ""))
        return repos

    return await asyncio.to_thread(_list_projects)
