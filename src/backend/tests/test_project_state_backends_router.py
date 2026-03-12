from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import register_exception_handlers
from app.models import Project, User
from app.routers import auth_dependencies as auth_deps
from app.routers.projects_routes import project_state_backends


def _build_app() -> FastAPI:
    app = FastAPI()
    app.include_router(project_state_backends.router, prefix="/api/projects")
    register_exception_handlers(app)

    async def _fake_user() -> User:
        return User(id="user-1", email="u@example.com", name="User 1")

    async def _fake_project(project_id: str) -> Project:
        return Project(id=project_id, user_id="user-1", name="Project 1")

    app.dependency_overrides[auth_deps.require_current_user] = _fake_user
    app.dependency_overrides[auth_deps.get_owned_project_or_404] = _fake_project
    return app


def test_state_backends_list_success(monkeypatch) -> None:
    async def _fake_list(*, project_id: str) -> list[dict]:
        assert project_id == "project-1"
        return [{"id": "sb-1", "name": "backend-1"}]

    monkeypatch.setattr(project_state_backends.state_service, "list_state_backends", _fake_list)
    with TestClient(_build_app()) as client:
        response = client.get("/api/projects/project-1/state-backends")
    assert response.status_code == 200
    assert response.json() == {"backends": [{"id": "sb-1", "name": "backend-1"}]}


def test_state_backends_gitlab_import_requires_session(monkeypatch) -> None:
    async def _no_token(*, user_id: str, settings) -> None:
        assert user_id == "user-1"
        return None

    monkeypatch.setattr(project_state_backends.state_service, "get_gitlab_token_for_user", _no_token)
    with TestClient(_build_app()) as client:
        response = client.post(
            "/api/projects/project-1/state-backends/import/gitlab",
            json={
                "repo_full_name": "group/repo",
                "branch": "main",
                "credential_profile_id": "cp-1",
            },
        )
    assert response.status_code == 401
    assert response.json() == {"code": "gitlab_login_required", "message": "GitLab login required"}


def test_state_backends_cloud_import_maps_value_error(monkeypatch) -> None:
    async def _raise_import(**_: object) -> dict:
        raise ValueError("profile_provider_mismatch")

    monkeypatch.setattr(project_state_backends.state_service, "import_cloud_backend", _raise_import)
    with TestClient(_build_app()) as client:
        response = client.post(
            "/api/projects/project-1/state-backends/import/cloud",
            json={
                "provider": "aws",
                "name": "s3-main",
                "credential_profile_id": "cp-1",
                "bucket": "bucket-1",
            },
        )
    assert response.status_code == 400
    assert response.json() == {"code": "profile_provider_mismatch", "message": "profile_provider_mismatch"}


def test_state_backends_sync_maps_not_found(monkeypatch) -> None:
    async def _raise_sync(*, backend_id: str, triggered_by: str, settings) -> dict:
        assert backend_id == "sb-404"
        assert triggered_by == "manual"
        raise ValueError("backend_not_found")

    monkeypatch.setattr(project_state_backends.state_service, "run_backend_sync", _raise_sync)
    with TestClient(_build_app()) as client:
        response = client.post("/api/projects/project-1/state-backends/sb-404/sync")
    assert response.status_code == 404
    assert response.json() == {"code": "backend_not_found", "message": "backend_not_found"}
