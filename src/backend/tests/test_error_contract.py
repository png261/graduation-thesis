from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.main import register_exception_handlers


def _build_test_app() -> FastAPI:
    app = FastAPI()
    register_exception_handlers(app)

    @app.get("/errors/string-detail")
    async def string_detail() -> dict[str, bool]:
        raise HTTPException(status_code=404, detail="Resource is missing")

    @app.get("/errors/dict-detail")
    async def dict_detail() -> dict[str, bool]:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "job_conflict",
                "message": "Another mutating job is active",
                "details": {"job_id": "job-1"},
            },
        )

    @app.get("/errors/dict-extra")
    async def dict_extra() -> dict[str, bool]:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "invalid_path",
                "message": "Path is invalid",
                "path": "/tmp",
            },
        )

    @app.get("/errors/validation/{count}")
    async def validation_error(count: int) -> dict[str, int]:
        return {"count": count}

    @app.get("/errors/unhandled")
    async def unhandled_error() -> dict[str, bool]:
        raise RuntimeError("boom")

    return app


def test_error_contract_from_string_http_exception() -> None:
    with TestClient(_build_test_app()) as client:
        response = client.get("/errors/string-detail")
    assert response.status_code == 404
    assert response.json() == {"code": "not_found", "message": "Resource is missing"}


def test_error_contract_from_dict_http_exception() -> None:
    with TestClient(_build_test_app()) as client:
        response = client.get("/errors/dict-detail")
    assert response.status_code == 409
    assert response.json() == {
        "code": "job_conflict",
        "message": "Another mutating job is active",
        "details": {"job_id": "job-1"},
    }


def test_error_contract_keeps_extra_fields_under_details() -> None:
    with TestClient(_build_test_app()) as client:
        response = client.get("/errors/dict-extra")
    assert response.status_code == 400
    assert response.json() == {
        "code": "invalid_path",
        "message": "Path is invalid",
        "details": {"path": "/tmp"},
    }


def test_error_contract_for_validation_errors() -> None:
    with TestClient(_build_test_app()) as client:
        response = client.get("/errors/validation/not-an-int")
    body = response.json()
    assert response.status_code == 422
    assert body["code"] == "validation_error"
    assert body["message"] == "Validation failed"
    assert isinstance(body.get("details", {}).get("errors"), list)


def test_error_contract_for_unhandled_exceptions() -> None:
    with TestClient(_build_test_app(), raise_server_exceptions=False) as client:
        response = client.get("/errors/unhandled")
    assert response.status_code == 500
    assert response.json() == {"code": "internal_error", "message": "Internal server error"}
