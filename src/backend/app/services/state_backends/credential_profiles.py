from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import select

from app import db
from app.models import CredentialProfile

from .crypto import decrypt_json, encrypt_json

_ALLOWED_PROVIDERS = {"aws", "gcs"}
_PROVIDER_ALIASES = {"gcloud": "gcs", "google": "gcs", "google_cloud": "gcs"}
_SECRET_KEYS = {
    "aws_access_key_id",
    "aws_secret_access_key",
    "aws_session_token",
    "gcp_credentials_json",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_provider(value: str) -> str:
    raw = (value or "").strip().lower()
    provider = _PROVIDER_ALIASES.get(raw, raw)
    if provider not in _ALLOWED_PROVIDERS:
        raise ValueError("unsupported_provider")
    return provider


def _normalize_name(value: str) -> str:
    name = (value or "").strip()
    if not name:
        raise ValueError("profile_name_required")
    if len(name) > 120:
        raise ValueError("profile_name_too_long")
    return name


def _normalize_credentials(payload: dict) -> dict[str, str]:
    if not isinstance(payload, dict):
        raise ValueError("credentials_must_be_object")
    result: dict[str, str] = {}
    for key, value in payload.items():
        if value is None:
            continue
        text = str(value).strip()
        if not text:
            continue
        result[str(key)] = text
    if not result:
        raise ValueError("credentials_required")
    return result


def mask_credentials(payload: dict[str, str]) -> dict[str, str]:
    masked: dict[str, str] = {}
    for key, value in payload.items():
        masked[key] = "****" if key in _SECRET_KEYS and value else value
    return masked


def _profile_to_dict(profile: CredentialProfile, *, secret: str, include_plain: bool = False) -> dict:
    creds = decrypt_json(secret=secret, value=profile.credentials_encrypted)
    payload = {
        "id": profile.id,
        "name": profile.name,
        "provider": profile.provider,
        "meta": profile.meta_json or {},
        "credentials": creds if include_plain else mask_credentials(creds),
        "created_at": profile.created_at.isoformat() if profile.created_at else _now().isoformat(),
        "updated_at": profile.updated_at.isoformat() if profile.updated_at else _now().isoformat(),
    }
    return payload


async def list_credential_profiles(*, user_id: str, secret: str) -> list[dict]:
    async with db.get_session() as session:
        rows = await session.execute(
            select(CredentialProfile)
            .where(CredentialProfile.user_id == user_id)
            .order_by(CredentialProfile.created_at.asc())
        )
        profiles = rows.scalars().all()
    return [_profile_to_dict(row, secret=secret) for row in profiles]


async def create_credential_profile(
    *,
    user_id: str,
    name: str,
    provider: str,
    credentials: dict,
    secret: str,
    meta: dict | None = None,
) -> dict:
    profile = CredentialProfile(
        id=str(uuid4()),
        user_id=user_id,
        name=_normalize_name(name),
        provider=_normalize_provider(provider),
        credentials_encrypted=encrypt_json(secret=secret, payload=_normalize_credentials(credentials)),
        meta_json=meta if isinstance(meta, dict) else {},
    )
    async with db.get_session() as session:
        session.add(profile)
    return _profile_to_dict(profile, secret=secret)


async def update_credential_profile(
    *,
    user_id: str,
    profile_id: str,
    name: str | None,
    credentials: dict | None,
    meta: dict | None,
    secret: str,
) -> dict:
    async with db.get_session() as session:
        row = await session.execute(
            select(CredentialProfile).where(
                CredentialProfile.id == profile_id,
                CredentialProfile.user_id == user_id,
            )
        )
        profile = row.scalar_one_or_none()
        if profile is None:
            raise ValueError("profile_not_found")
        if name is not None:
            profile.name = _normalize_name(name)
        if credentials is not None:
            profile.credentials_encrypted = encrypt_json(
                secret=secret,
                payload=_normalize_credentials(credentials),
            )
        if meta is not None and isinstance(meta, dict):
            profile.meta_json = meta
        profile.updated_at = _now()
        await session.flush()
    return _profile_to_dict(profile, secret=secret)


async def delete_credential_profile(*, user_id: str, profile_id: str) -> bool:
    async with db.get_session() as session:
        row = await session.execute(
            select(CredentialProfile).where(
                CredentialProfile.id == profile_id,
                CredentialProfile.user_id == user_id,
            )
        )
        profile = row.scalar_one_or_none()
        if profile is None:
            return False
        await session.delete(profile)
    return True


async def resolve_profile_credentials(
    *,
    profile_id: str,
    user_id: str,
    secret: str,
) -> tuple[str, dict[str, str]]:
    async with db.get_session() as session:
        row = await session.execute(
            select(CredentialProfile).where(
                CredentialProfile.id == profile_id,
                CredentialProfile.user_id == user_id,
            )
        )
        profile = row.scalar_one_or_none()
    if profile is None:
        raise ValueError("profile_not_found")
    credentials = decrypt_json(secret=secret, value=profile.credentials_encrypted)
    return profile.provider, credentials
