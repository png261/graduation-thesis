from __future__ import annotations

import base64
import json

import pytest

from app.core.config import Settings
from app.services.state_backends import gitlab_auth


def _settings() -> Settings:
    return Settings(
        STATE_ENCRYPTION_KEY="state-secret",
        GITLAB_CLIENT_ID="gitlab-client",
        GITLAB_REDIRECT_URI="https://example.com/gitlab/callback",
    )


def test_parse_oauth_state_round_trip() -> None:
    settings = _settings()
    state = gitlab_auth.build_oauth_state(user_id="user-1", settings=settings)
    assert gitlab_auth.parse_oauth_state(state=state, settings=settings) == "user-1"


def test_parse_oauth_state_rejects_tampered_signature() -> None:
    settings = _settings()
    state = gitlab_auth.build_oauth_state(user_id="user-1", settings=settings)
    tampered = f"{state}x"
    with pytest.raises(ValueError, match="invalid_oauth_state"):
        gitlab_auth.parse_oauth_state(state=tampered, settings=settings)


def test_parse_oauth_state_rejects_expired_payload() -> None:
    settings = _settings()
    payload = {"user_id": "user-1", "nonce": "n", "issued_at": 1}
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    encoded = base64.urlsafe_b64encode(raw).decode("utf-8")
    sig = gitlab_auth._state_signature(settings.state_encryption_key, encoded)
    state = f"{encoded}.{sig}"
    with pytest.raises(ValueError, match="oauth_state_expired"):
        gitlab_auth.parse_oauth_state(state=state, settings=settings)


def test_build_authorize_url_uses_oauth_settings() -> None:
    settings = _settings()
    url = gitlab_auth.build_authorize_url(user_id="user-1", settings=settings)
    assert "client_id=gitlab-client" in url
    assert "redirect_uri=https%3A%2F%2Fexample.com%2Fgitlab%2Fcallback" in url
    assert "state=" in url
