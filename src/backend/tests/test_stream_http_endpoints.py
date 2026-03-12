from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from typing import Any, AsyncIterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers import auth_dependencies as auth_deps
from app.routers.projects_routes import project_ansible, project_jobs, project_opentofu
from app.services.jobs.errors import JobConflictError


def _build_app() -> FastAPI:
    app = FastAPI()
    app.include_router(project_opentofu.router, prefix="/api/projects")
    app.include_router(project_ansible.router, prefix="/api/projects")
    app.include_router(project_jobs.router, prefix="/api/projects")

    async def _fake_owned_project_or_404(project_id: str) -> Any:
        return SimpleNamespace(id=project_id, user_id="user-1")

    app.dependency_overrides[auth_deps.get_owned_project_or_404] = _fake_owned_project_or_404
    return app


def _read_stream_text(response) -> str:
    chunks: list[str] = []
    for chunk in response.iter_text():
        if chunk:
            chunks.append(chunk)
    return "".join(chunks)


async def _call_asgi_with_disconnect(
    app: FastAPI,
    *,
    method: str,
    path: str,
    json_body: dict[str, Any] | None = None,
    disconnect_after_receive_polls: int = 1,
) -> tuple[int, str]:
    request_body = b""
    headers: list[tuple[bytes, bytes]] = [(b"host", b"testserver")]
    if json_body is not None:
        request_body = json.dumps(json_body).encode("utf-8")
        headers.append((b"content-type", b"application/json"))
        headers.append((b"content-length", str(len(request_body)).encode("ascii")))
    else:
        headers.append((b"content-length", b"0"))

    scope: dict[str, Any] = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": path,
        "raw_path": path.encode("ascii"),
        "query_string": b"",
        "headers": headers,
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
    }

    receive_polls = 0
    request_consumed = False
    response_status = 500
    response_parts: list[bytes] = []

    async def receive() -> dict[str, Any]:
        nonlocal receive_polls, request_consumed
        if not request_consumed:
            request_consumed = True
            return {"type": "http.request", "body": request_body, "more_body": False}
        receive_polls += 1
        if receive_polls > disconnect_after_receive_polls:
            return {"type": "http.disconnect"}
        await asyncio.sleep(0)
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: dict[str, Any]) -> None:
        nonlocal response_status
        if message["type"] == "http.response.start":
            response_status = int(message["status"])
            return
        if message["type"] == "http.response.body":
            response_parts.append(message.get("body", b""))

    await app(scope, receive, send)
    return response_status, b"".join(response_parts).decode("utf-8", errors="replace")


def test_apply_stream_http_success(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    async def _fake_enqueue(*, project, kind, payload):
        captured["project_id"] = project.id
        captured["kind"] = kind
        captured["payload"] = payload
        return {"id": "job-apply"}

    async def _fake_stream(**_kwargs) -> AsyncIterator[str]:
        yield 'data: {"type":"deploy.start"}\n\n'
        yield 'data: {"type":"deploy.done","status":"ok"}\n\n'

    monkeypatch.setattr(project_opentofu.jobs_service, "enqueue_project_job", _fake_enqueue)
    monkeypatch.setattr(project_opentofu.jobs_service, "stream_job_events", _fake_stream)

    with TestClient(_build_app()) as client:
        with client.stream(
            "POST",
            "/api/projects/project-1/opentofu/deploy/apply/stream",
            json={"selected_modules": ["core"], "intent": "deploy", "override_policy": True},
        ) as response:
            body = _read_stream_text(response)

    assert response.status_code == 200
    assert '"type":"deploy.start"' in body
    assert '"status":"ok"' in body
    assert captured["project_id"] == "project-1"
    assert captured["kind"] == "apply"
    assert captured["payload"]["options"]["override_policy"] is True


def test_apply_stream_http_jobs_error(monkeypatch) -> None:
    async def _raise_conflict(*, project, kind, payload):
        raise JobConflictError()

    async def _unused_stream(**_kwargs) -> AsyncIterator[str]:
        if False:
            yield ""

    monkeypatch.setattr(project_opentofu.jobs_service, "enqueue_project_job", _raise_conflict)
    monkeypatch.setattr(project_opentofu.jobs_service, "stream_job_events", _unused_stream)

    with TestClient(_build_app()) as client:
        with client.stream(
            "POST",
            "/api/projects/project-1/opentofu/deploy/apply/stream",
            json={"selected_modules": []},
        ) as response:
            body = _read_stream_text(response)

    assert response.status_code == 200
    assert '"type": "error"' in body
    assert '"code": "job_conflict"' in body


def test_plan_stream_http_success(monkeypatch) -> None:
    async def _fake_enqueue(*, project, kind, payload):
        return {"id": "job-plan"}

    async def _fake_stream(**_kwargs) -> AsyncIterator[str]:
        yield 'data: {"type":"plan.start"}\n\n'
        yield 'data: {"type":"plan.done","status":"ok"}\n\n'

    monkeypatch.setattr(project_opentofu.jobs_service, "enqueue_project_job", _fake_enqueue)
    monkeypatch.setattr(project_opentofu.jobs_service, "stream_job_events", _fake_stream)

    with TestClient(_build_app()) as client:
        with client.stream(
            "POST",
            "/api/projects/project-1/opentofu/deploy/plan/stream",
            json={"selected_modules": ["core"], "intent": "plan"},
        ) as response:
            body = _read_stream_text(response)

    assert response.status_code == 200
    assert '"type":"plan.start"' in body
    assert '"status":"ok"' in body


def test_ansible_stream_http_success(monkeypatch) -> None:
    async def _fake_enqueue(*, project, kind, payload):
        return {"id": "job-ansible"}

    async def _fake_stream(**_kwargs) -> AsyncIterator[str]:
        yield 'data: {"type":"config.start"}\n\n'
        yield 'data: {"type":"config.done","status":"ok"}\n\n'

    monkeypatch.setattr(project_ansible.jobs_service, "enqueue_project_job", _fake_enqueue)
    monkeypatch.setattr(project_ansible.jobs_service, "stream_job_events", _fake_stream)

    with TestClient(_build_app()) as client:
        with client.stream(
            "POST",
            "/api/projects/project-1/ansible/run/stream",
            json={"selected_modules": ["core"], "intent": "configure"},
        ) as response:
            body = _read_stream_text(response)

    assert response.status_code == 200
    assert '"type":"config.start"' in body
    assert '"status":"ok"' in body


def test_jobs_events_stream_http_success(monkeypatch) -> None:
    async def _fake_stream(**_kwargs) -> AsyncIterator[str]:
        yield 'data: {"type":"job.running"}\n\n'
        yield 'data: {"type":"job.terminal","status":"succeeded"}\n\n'

    monkeypatch.setattr(project_jobs.jobs_service, "stream_job_events", _fake_stream)

    with TestClient(_build_app()) as client:
        with client.stream(
            "GET",
            "/api/projects/project-1/jobs/job-1/events/stream?from_seq=4",
        ) as response:
            body = _read_stream_text(response)

    assert response.status_code == 200
    assert '"type":"job.running"' in body
    assert '"status":"succeeded"' in body


def test_jobs_events_stream_http_jobs_error(monkeypatch) -> None:
    async def _raise_conflict(**_kwargs):
        raise JobConflictError()
        if False:
            yield ""

    monkeypatch.setattr(project_jobs.jobs_service, "stream_job_events", _raise_conflict)

    with TestClient(_build_app()) as client:
        with client.stream(
            "GET",
            "/api/projects/project-1/jobs/job-1/events/stream",
        ) as response:
            body = _read_stream_text(response)

    assert response.status_code == 200
    assert '"type": "error"' in body
    assert '"code": "job_conflict"' in body


@pytest.mark.asyncio
async def test_apply_stream_asgi_disconnect_stops_after_first_event(monkeypatch: pytest.MonkeyPatch) -> None:
    state: dict[str, int] = {"yielded": 0}

    async def _fake_enqueue(*, project, kind, payload):
        return {"id": "job-apply"}

    async def _stream_events(**kwargs) -> AsyncIterator[str]:
        request = kwargs["request"]
        state["yielded"] += 1
        yield 'data: {"type":"deploy.start"}\n\n'
        if await request.is_disconnected():
            return
        state["yielded"] += 1
        yield 'data: {"type":"deploy.done","status":"ok"}\n\n'

    monkeypatch.setattr(project_opentofu.jobs_service, "enqueue_project_job", _fake_enqueue)
    monkeypatch.setattr(project_opentofu.jobs_service, "stream_job_events", _stream_events)

    status, body = await _call_asgi_with_disconnect(
        _build_app(),
        method="POST",
        path="/api/projects/project-1/opentofu/deploy/apply/stream",
        json_body={"selected_modules": ["core"]},
        disconnect_after_receive_polls=1,
    )

    assert status == 200
    assert state["yielded"] == 1
    assert '"type":"deploy.done"' not in body


@pytest.mark.asyncio
async def test_jobs_events_stream_asgi_disconnect_stops_after_first_event(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state: dict[str, int] = {"yielded": 0}

    async def _stream_events(**kwargs) -> AsyncIterator[str]:
        request = kwargs["request"]
        state["yielded"] += 1
        yield 'data: {"type":"job.running"}\n\n'
        if await request.is_disconnected():
            return
        state["yielded"] += 1
        yield 'data: {"type":"job.terminal","status":"succeeded"}\n\n'

    monkeypatch.setattr(project_jobs.jobs_service, "stream_job_events", _stream_events)

    status, body = await _call_asgi_with_disconnect(
        _build_app(),
        method="GET",
        path="/api/projects/project-1/jobs/job-1/events/stream",
        disconnect_after_receive_polls=1,
    )

    assert status == 200
    assert state["yielded"] == 1
    assert '"type":"job.running"' in body
    assert '"type":"job.terminal"' not in body
