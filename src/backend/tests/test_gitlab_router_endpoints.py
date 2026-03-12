from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import register_exception_handlers
from app.models import User
from app.routers import auth_dependencies as auth_deps
from app.routers import gitlab as gitlab_router


def _build_app() -> FastAPI:
    app = FastAPI()
    app.include_router(gitlab_router.router)
    register_exception_handlers(app)

    async def _fake_user() -> User:
        return User(id="user-1", email="u@example.com", name="User 1")

    app.dependency_overrides[auth_deps.require_current_user] = _fake_user
    return app


def test_gitlab_session_success(monkeypatch) -> None:
    async def _fake_session(*, user_id: str, settings) -> dict:
        assert user_id == "user-1"
        return {"authenticated": True, "login": "alice"}

    monkeypatch.setattr(gitlab_router.gitlab_auth, "get_user_session", _fake_session)
    with TestClient(_build_app()) as client:
        response = client.get("/api/gitlab/session")
    assert response.status_code == 200
    assert response.json() == {"authenticated": True, "login": "alice"}


def test_gitlab_repos_requires_login(monkeypatch) -> None:
    async def _none_token(*, user_id: str, settings):
        assert user_id == "user-1"
        return None

    monkeypatch.setattr(gitlab_router.gitlab_auth, "get_user_access_token", _none_token)
    with TestClient(_build_app()) as client:
        response = client.get("/api/gitlab/repos")
    assert response.status_code == 401
    assert response.json() == {"code": "gitlab_login_required", "message": "GitLab login required"}


def test_gitlab_repos_success(monkeypatch) -> None:
    async def _token(*, user_id: str, settings):
        assert user_id == "user-1"
        return "token-1"

    async def _repos(*, access_token: str, settings) -> list[dict]:
        assert access_token == "token-1"
        return [{"full_name": "group/repo"}]

    monkeypatch.setattr(gitlab_router.gitlab_auth, "get_user_access_token", _token)
    monkeypatch.setattr(gitlab_router.gitlab_auth, "list_repositories", _repos)
    with TestClient(_build_app()) as client:
        response = client.get("/api/gitlab/repos")
    assert response.status_code == 200
    assert response.json() == {"repos": [{"full_name": "group/repo"}]}


def test_gitlab_oauth_start_maps_config_error(monkeypatch) -> None:
    def _raise_start(*, user_id: str, settings) -> str:
        raise ValueError("gitlab_oauth_not_configured")

    monkeypatch.setattr(gitlab_router.gitlab_auth, "build_authorize_url", _raise_start)
    with TestClient(_build_app()) as client:
        response = client.get("/api/gitlab/oauth/start")
    assert response.status_code == 500
    assert response.json() == {"code": "gitlab_oauth_not_configured", "message": "gitlab_oauth_not_configured"}


def test_gitlab_oauth_callback_missing_code_or_state() -> None:
    with TestClient(_build_app()) as client:
        response = client.get("/api/gitlab/oauth/callback")
    assert response.status_code == 200
    assert "missing_code_or_state" in response.text


def test_gitlab_oauth_callback_success(monkeypatch) -> None:
    def _parse(*, state: str, settings) -> str:
        assert state == "state-1"
        return "user-1"

    async def _exchange(*, code: str, settings) -> dict:
        assert code == "code-1"
        return {"access_token": "token-1", "scope": "read_api"}

    async def _user(access_token: str, settings) -> dict:
        assert access_token == "token-1"
        return {"id": "gid-1", "username": "alice"}

    async def _save(*, user_id: str, token_payload: dict, user_payload: dict, settings) -> None:
        assert user_id == "user-1"
        assert token_payload["access_token"] == "token-1"
        assert user_payload["username"] == "alice"

    monkeypatch.setattr(gitlab_router.gitlab_auth, "parse_oauth_state", _parse)
    monkeypatch.setattr(gitlab_router.gitlab_auth, "exchange_code", _exchange)
    monkeypatch.setattr(gitlab_router.gitlab_auth, "fetch_gitlab_user", _user)
    monkeypatch.setattr(gitlab_router.gitlab_auth, "save_user_token", _save)

    with TestClient(_build_app()) as client:
        response = client.get("/api/gitlab/oauth/callback?code=code-1&state=state-1")
    assert response.status_code == 200
    assert "connected" in response.text


def test_gitlab_oauth_callback_error_popup(monkeypatch) -> None:
    def _parse(*, state: str, settings) -> str:
        return "user-1"

    async def _exchange(*, code: str, settings) -> dict:
        raise RuntimeError("exchange_failed")

    monkeypatch.setattr(gitlab_router.gitlab_auth, "parse_oauth_state", _parse)
    monkeypatch.setattr(gitlab_router.gitlab_auth, "exchange_code", _exchange)
    with TestClient(_build_app()) as client:
        response = client.get("/api/gitlab/oauth/callback?code=code-1&state=state-1")
    assert response.status_code == 200
    assert "exchange_failed" in response.text
