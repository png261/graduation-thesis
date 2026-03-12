from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import register_exception_handlers
from app.models import User
from app.routers import auth_dependencies as auth_deps
from app.routers import state as state_router


def _build_app() -> FastAPI:
    app = FastAPI()
    app.include_router(state_router.router)
    register_exception_handlers(app)

    async def _fake_user() -> User:
        return User(id="user-1", email="u@example.com", name="User 1")

    app.dependency_overrides[auth_deps.require_current_user] = _fake_user
    return app


def test_state_profiles_list_success(monkeypatch) -> None:
    async def _fake_list(*, user_id: str, secret: str) -> list[dict]:
        assert user_id == "user-1"
        assert secret
        return [{"id": "cp-1", "name": "aws-main", "provider": "aws"}]

    monkeypatch.setattr(state_router.credential_profiles, "list_credential_profiles", _fake_list)
    with TestClient(_build_app()) as client:
        response = client.get("/api/state/credential-profiles")
    assert response.status_code == 200
    assert response.json() == {"profiles": [{"id": "cp-1", "name": "aws-main", "provider": "aws"}]}


def test_state_profiles_create_maps_value_error(monkeypatch) -> None:
    async def _raise_create(**_: object) -> dict:
        raise ValueError("credentials_required")

    monkeypatch.setattr(state_router.credential_profiles, "create_credential_profile", _raise_create)
    with TestClient(_build_app()) as client:
        response = client.post(
            "/api/state/credential-profiles",
            json={"name": "p1", "provider": "aws", "credentials": {}},
        )
    assert response.status_code == 400
    assert response.json() == {"code": "credentials_required", "message": "credentials_required"}


def test_state_profiles_update_maps_not_found(monkeypatch) -> None:
    async def _raise_update(**_: object) -> dict:
        raise ValueError("profile_not_found")

    monkeypatch.setattr(state_router.credential_profiles, "update_credential_profile", _raise_update)
    with TestClient(_build_app()) as client:
        response = client.put("/api/state/credential-profiles/cp-404", json={"name": "updated"})
    assert response.status_code == 404
    assert response.json() == {"code": "profile_not_found", "message": "profile_not_found"}


def test_state_profiles_delete_not_found(monkeypatch) -> None:
    async def _fake_delete(*, user_id: str, profile_id: str) -> bool:
        assert user_id == "user-1"
        assert profile_id == "cp-404"
        return False

    monkeypatch.setattr(state_router.credential_profiles, "delete_credential_profile", _fake_delete)
    with TestClient(_build_app()) as client:
        response = client.delete("/api/state/credential-profiles/cp-404")
    assert response.status_code == 404
    assert response.json() == {"code": "profile_not_found", "message": "Credential profile not found"}
