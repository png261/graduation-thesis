"""Application authentication helpers (Google/GitHub OAuth + app sessions)."""
from __future__ import annotations

from .identity import (
    bridge_legacy_github_accounts,
    get_user_github_identity,
    list_user_providers,
    upsert_user_identity,
)
from .oauth import (
    APP_SESSION_COOKIE,
    OAUTH_STATE_COOKIE,
    build_github_login_url,
    build_google_login_url,
    ensure_github_oauth_config,
    ensure_google_oauth_config,
    exchange_github_code_for_token,
    exchange_google_code_for_token,
    google_get_user,
)
from .sessions import create_user_session, delete_user_session, get_valid_user_session
from .shared import cookie_kwargs
from .tokens import encrypt_token
from .types import AuthError, AuthSessionContext

__all__ = [
    "APP_SESSION_COOKIE",
    "OAUTH_STATE_COOKIE",
    "AuthError",
    "AuthSessionContext",
    "bridge_legacy_github_accounts",
    "build_github_login_url",
    "build_google_login_url",
    "cookie_kwargs",
    "create_user_session",
    "delete_user_session",
    "encrypt_token",
    "ensure_github_oauth_config",
    "ensure_google_oauth_config",
    "exchange_github_code_for_token",
    "exchange_google_code_for_token",
    "get_user_github_identity",
    "get_valid_user_session",
    "google_get_user",
    "list_user_providers",
    "upsert_user_identity",
]
