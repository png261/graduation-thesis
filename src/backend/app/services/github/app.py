from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.services.github.auth_common import GITHUB_API_URL, GitHubAuthError
from app.services.scm import persistence as scm_persistence

_GITHUB_API_VERSION = "2022-11-28"


@dataclass(slots=True)
class GitHubAppInstallation:
    installation_id: str
    account_id: str
    account_login: str
    target_type: str
    permissions: dict[str, str]


@dataclass(slots=True)
class GitHubInstallationToken:
    token: str
    expires_at: datetime | None
    permissions: dict[str, str]


def _require(value: str, *, name: str) -> str:
    text = value.strip()
    if not text:
        raise GitHubAuthError(f"Missing {name}")
    return text


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("utf-8")


def _jwt_payload(settings: Settings) -> str:
    now = datetime.now(UTC)
    payload = {
        "iat": int((now - timedelta(seconds=60)).timestamp()),
        "exp": int((now + timedelta(minutes=9)).timestamp()),
        "iss": _require(settings.github_app_id, name="GITHUB_APP_ID"),
    }
    header = {"alg": "RS256", "typ": "JWT"}
    signing_input = ".".join(
        [
            _b64url(json.dumps(header, separators=(",", ":"), sort_keys=True).encode("utf-8")),
            _b64url(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")),
        ]
    )
    private_key_raw = _require(settings.github_app_private_key, name="GITHUB_APP_PRIVATE_KEY")
    private_key = serialization.load_pem_private_key(
        private_key_raw.encode("utf-8").replace(b"\\n", b"\n"),
        password=None,
    )
    signature = private_key.sign(signing_input.encode("utf-8"), padding.PKCS1v15(), hashes.SHA256())
    return f"{signing_input}.{_b64url(signature)}"


def _signed_state(secret: str, payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    body = _b64url(raw)
    digest = hmac.new(secret.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).digest()
    return f"{body}.{_b64url(digest)}"


def _load_state(secret: str, token: str) -> dict[str, Any]:
    body, dot, sig = token.partition(".")
    if not dot or not body or not sig:
        raise GitHubAuthError("Invalid GitHub App state")
    expected = hmac.new(secret.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).digest()
    actual = base64.urlsafe_b64decode(sig + ("=" * ((4 - len(sig) % 4) % 4)))
    if not hmac.compare_digest(expected, actual):
        raise GitHubAuthError("Invalid GitHub App state signature")
    payload = json.loads(base64.urlsafe_b64decode(body + ("=" * ((4 - len(body) % 4) % 4))))
    if not isinstance(payload, dict):
        raise GitHubAuthError("Invalid GitHub App state payload")
    expires_at = int(payload.get("exp") or 0)
    if expires_at <= int(datetime.now(UTC).timestamp()):
        raise GitHubAuthError("GitHub App state expired")
    return payload


def _api_headers(token: str) -> dict[str, str]:
    return {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": _GITHUB_API_VERSION,
    }


async def _github_request(
    method: str,
    path: str,
    *,
    token: str,
    json_body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.request(
            method,
            f"{GITHUB_API_URL}{path}",
            headers=_api_headers(token),
            json=json_body,
        )
    if response.status_code >= 400:
        try:
            payload = response.json()
        except Exception:
            payload = None
        message = ""
        if isinstance(payload, dict):
            message = str(payload.get("message") or "").strip()
        if not message:
            message = f"GitHub API request failed ({response.status_code})"
        raise GitHubAuthError(message)
    payload = response.json()
    if not isinstance(payload, dict):
        raise GitHubAuthError("Invalid GitHub API response")
    return payload


def _append_state(install_url: str, state: str) -> str:
    raw = _require(install_url, name="GITHUB_APP_INSTALL_URL")
    parts = urlsplit(raw)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query["state"] = state
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def build_install_url(settings: Settings, *, project_id: str, user_id: str, origin: str) -> str:
    state = _signed_state(
        settings.oauth_state_signing_secret,
        {
            "project_id": project_id,
            "user_id": user_id,
            "origin": origin,
            "exp": int((datetime.now(UTC) + timedelta(minutes=10)).timestamp()),
            "nonce": secrets.token_urlsafe(12),
        },
    )
    return _append_state(settings.github_app_install_url, state)


async def get_installation_details(settings: Settings, installation_id: str) -> GitHubAppInstallation:
    payload = await _github_request(
        "GET",
        f"/app/installations/{installation_id}",
        token=_jwt_payload(settings),
    )
    account = payload.get("account") if isinstance(payload.get("account"), dict) else {}
    permissions = payload.get("permissions") if isinstance(payload.get("permissions"), dict) else {}
    return GitHubAppInstallation(
        installation_id=str(payload.get("id") or installation_id),
        account_id=str(account.get("id") or ""),
        account_login=str(account.get("login") or ""),
        target_type=str(payload.get("target_type") or account.get("type") or ""),
        permissions={str(key): str(value) for key, value in permissions.items()},
    )


async def mint_installation_token(settings: Settings, installation_id: str) -> GitHubInstallationToken:
    payload = await _github_request(
        "POST",
        f"/app/installations/{installation_id}/access_tokens",
        token=_jwt_payload(settings),
        json_body={},
    )
    expires_at_raw = str(payload.get("expires_at") or "").strip()
    expires_at = None
    if expires_at_raw:
        expires_at = datetime.fromisoformat(expires_at_raw.replace("Z", "+00:00"))
    permissions = payload.get("permissions") if isinstance(payload.get("permissions"), dict) else {}
    token = str(payload.get("token") or "")
    if not token:
        raise GitHubAuthError("Missing GitHub installation access token")
    return GitHubInstallationToken(
        token=token,
        expires_at=expires_at,
        permissions={str(key): str(value) for key, value in permissions.items()},
    )


async def list_installation_repositories(settings: Settings, installation_id: str) -> list[dict[str, Any]]:
    access = await mint_installation_token(settings, installation_id)
    payload = await _github_request(
        "GET",
        "/installation/repositories",
        token=access.token,
    )
    repos = payload.get("repositories")
    return [repo for repo in repos if isinstance(repo, dict)] if isinstance(repos, list) else []


def project_has_installation(project: scm_persistence.Project) -> bool:
    return bool((project.github_installation_id or "").strip())


def project_auth_mode(project: scm_persistence.Project) -> str:
    if project_has_installation(project):
        return "app_installation"
    return "none"


async def complete_installation_callback(
    session: AsyncSession,
    *,
    settings: Settings,
    project_id: str,
    installation_id: str,
    state: str,
) -> tuple[str, GitHubAppInstallation]:
    if not installation_id.strip():
        raise GitHubAuthError("Missing GitHub App installation id")
    state_payload = _load_state(settings.oauth_state_signing_secret, state)
    state_project_id = str(state_payload.get("project_id") or "")
    user_id = str(state_payload.get("user_id") or "")
    origin = str(state_payload.get("origin") or "")
    if not state_project_id or state_project_id != project_id or not user_id or not origin:
        raise GitHubAuthError("Invalid GitHub App state payload")
    project = (
        await session.execute(
            select(scm_persistence.Project).where(
                scm_persistence.Project.id == project_id,
                scm_persistence.Project.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if project is None:
        raise GitHubAuthError("Project not found for GitHub App callback")
    installation = await get_installation_details(settings, installation_id)
    installation_changed = str(project.github_installation_id or "") != installation.installation_id
    project.github_installation_id = installation.installation_id
    project.github_installation_account_id = installation.account_id or None
    project.github_installation_account_login = installation.account_login or None
    project.github_installation_target_type = installation.target_type or None
    project.github_permissions_json = installation.permissions or None
    if installation_changed:
        project.github_repo_full_name = None
        project.github_repository_id = None
        project.github_repository_owner = None
        project.github_base_branch = None
        project.github_working_branch = None
        project.github_connected_at = None
    session.add(project)
    await session.flush()
    return origin, installation
