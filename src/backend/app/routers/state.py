"""User-scoped state backend utility endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.models import User
from app.routers import auth_dependencies as auth_deps
from app.routers.http_errors import raise_http_error
from app.services.state_backends import credential_profiles

router = APIRouter(prefix="/api/state", tags=["state"])


class CredentialProfileCreateBody(BaseModel):
    name: str
    provider: str
    credentials: dict = Field(default_factory=dict)
    meta: dict = Field(default_factory=dict)


class CredentialProfileUpdateBody(BaseModel):
    name: str | None = None
    credentials: dict | None = None
    meta: dict | None = None


@router.get("/credential-profiles")
async def list_profiles(user: User = Depends(auth_deps.require_current_user)) -> dict:
    settings = get_settings()
    profiles = await credential_profiles.list_credential_profiles(
        user_id=user.id,
        secret=settings.state_encryption_key,
    )
    return {"profiles": profiles}


@router.post("/credential-profiles")
async def create_profile(
    body: CredentialProfileCreateBody,
    user: User = Depends(auth_deps.require_current_user),
) -> dict:
    settings = get_settings()
    try:
        profile = await credential_profiles.create_credential_profile(
            user_id=user.id,
            name=body.name,
            provider=body.provider,
            credentials=body.credentials,
            meta=body.meta,
            secret=settings.state_encryption_key,
        )
        return profile
    except ValueError as exc:
        raise_http_error(400, code=str(exc), message=str(exc))


@router.put("/credential-profiles/{profile_id}")
async def update_profile(
    profile_id: str,
    body: CredentialProfileUpdateBody,
    user: User = Depends(auth_deps.require_current_user),
) -> dict:
    settings = get_settings()
    try:
        profile = await credential_profiles.update_credential_profile(
            user_id=user.id,
            profile_id=profile_id,
            name=body.name,
            credentials=body.credentials,
            meta=body.meta,
            secret=settings.state_encryption_key,
        )
        return profile
    except ValueError as exc:
        status = 404 if str(exc) == "profile_not_found" else 400
        raise_http_error(status, code=str(exc), message=str(exc))


@router.delete("/credential-profiles/{profile_id}")
async def delete_profile(
    profile_id: str,
    user: User = Depends(auth_deps.require_current_user),
) -> dict:
    deleted = await credential_profiles.delete_credential_profile(user_id=user.id, profile_id=profile_id)
    if not deleted:
        raise_http_error(404, code="profile_not_found", message="Credential profile not found")
    return {"ok": True}
