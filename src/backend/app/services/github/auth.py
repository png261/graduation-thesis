"""GitHub OAuth/session/token helpers."""
from __future__ import annotations

from .auth_api import (
    _format_github_error,
    github_create_pull_request,
    github_create_repo,
    github_get_repo,
    github_get_user,
    github_list_repos,
)
from .auth_common import (
    GITHUB_API_URL,
    GITHUB_AUTHORIZE_URL,
    GITHUB_SCOPES,
    GITHUB_TOKEN_URL,
    OAUTH_STATE_COOKIE,
    SESSION_COOKIE,
    GitHubAuthError,
)
from .auth_crypto import (
    decrypt_token,
    encrypt_token,
    ensure_oauth_config,
    token_expiry_from_payload,
)
from .auth_oauth import build_login_url, exchange_code_for_token
from .auth_store import (
    create_session_for_account,
    delete_session,
    get_account_access_token,
    get_valid_session_account,
    has_active_session_for_account,
    upsert_account_from_oauth,
)

# Back-compat alias for previous private helper name.
_token_expiry_from_payload = token_expiry_from_payload

__all__ = [
    "GITHUB_API_URL",
    "GITHUB_AUTHORIZE_URL",
    "GITHUB_SCOPES",
    "GITHUB_TOKEN_URL",
    "GitHubAuthError",
    "OAUTH_STATE_COOKIE",
    "SESSION_COOKIE",
    "_format_github_error",
    "_token_expiry_from_payload",
    "build_login_url",
    "create_session_for_account",
    "decrypt_token",
    "delete_session",
    "encrypt_token",
    "ensure_oauth_config",
    "exchange_code_for_token",
    "get_account_access_token",
    "get_valid_session_account",
    "github_create_pull_request",
    "github_create_repo",
    "github_get_repo",
    "github_get_user",
    "github_list_repos",
    "has_active_session_for_account",
    "token_expiry_from_payload",
    "upsert_account_from_oauth",
]
