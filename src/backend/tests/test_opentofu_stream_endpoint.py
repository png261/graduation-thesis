from __future__ import annotations

from types import SimpleNamespace
from typing import Any, AsyncIterator

import pytest

from app.routers.projects_routes import project_opentofu
from app.services.jobs.errors import JobConflictError


class _FakeRequest:
    def __init__(self, disconnect_after_calls: int | None = None) -> None:
        self._disconnect_after_calls = disconnect_after_calls
        self._calls = 0

    async def is_disconnected(self) -> bool:
        self._calls += 1
        if self._disconnect_after_calls is None:
            return False
        return self._calls > self._disconnect_after_calls


async def _collect_stream_payloads(response) -> list[str]:
    chunks: list[str] = []
    async for payload in response.body_iterator:
        chunks.append(payload.decode("utf-8") if isinstance(payload, bytes) else str(payload))
    return chunks


@pytest.mark.asyncio
async def test_apply_stream_emits_job_events(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_payload: dict[str, Any] = {}

    async def _fake_enqueue_project_job(*, project, kind, payload):
        captured_payload["project_id"] = project.id
        captured_payload["kind"] = kind
        captured_payload["payload"] = payload
        return {"id": "job-123"}

    async def _fake_stream_job_events(**_kwargs) -> AsyncIterator[str]:
        yield 'data: {"type":"deploy.start"}\n\n'
        yield 'data: {"type":"deploy.done","status":"ok"}\n\n'

    monkeypatch.setattr(project_opentofu.jobs_service, "enqueue_project_job", _fake_enqueue_project_job)
    monkeypatch.setattr(project_opentofu.jobs_service, "stream_job_events", _fake_stream_job_events)

    body = project_opentofu.OpenTofuApplyBody(
        selected_modules=["network"],
        intent="deploy core infra",
        override_policy=True,
    )
    request = _FakeRequest()
    project = SimpleNamespace(id="project-1", user_id="user-1")

    response = await project_opentofu.opentofu_apply_stream(body, request=request, project=project)
    chunks = await _collect_stream_payloads(response)

    assert len(chunks) == 2
    assert '{"type":"deploy.start"}' in chunks[0]
    assert '"status":"ok"' in chunks[1]
    assert captured_payload["project_id"] == "project-1"
    assert captured_payload["kind"] == "apply"
    assert captured_payload["payload"]["options"]["override_policy"] is True


@pytest.mark.asyncio
async def test_apply_stream_emits_error_event_when_enqueue_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _raise_conflict(*, project, kind, payload):
        raise JobConflictError()

    async def _unused_stream_job_events(**_kwargs) -> AsyncIterator[str]:
        if False:
            yield ""

    monkeypatch.setattr(project_opentofu.jobs_service, "enqueue_project_job", _raise_conflict)
    monkeypatch.setattr(project_opentofu.jobs_service, "stream_job_events", _unused_stream_job_events)

    response = await project_opentofu.opentofu_apply_stream(
        project_opentofu.OpenTofuApplyBody(selected_modules=[]),
        request=_FakeRequest(),
        project=SimpleNamespace(id="project-1", user_id="user-1"),
    )
    chunks = await _collect_stream_payloads(response)

    assert len(chunks) == 1
    assert '"type": "error"' in chunks[0]
    assert '"code": "job_conflict"' in chunks[0]


@pytest.mark.asyncio
async def test_apply_stream_stops_when_client_disconnects(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake_enqueue_project_job(*, project, kind, payload):
        return {"id": "job-123"}

    async def _fake_stream_job_events(**_kwargs) -> AsyncIterator[str]:
        yield 'data: {"type":"deploy.start"}\n\n'
        yield 'data: {"type":"log","line":"step-2"}\n\n'
        yield 'data: {"type":"deploy.done","status":"ok"}\n\n'

    monkeypatch.setattr(project_opentofu.jobs_service, "enqueue_project_job", _fake_enqueue_project_job)
    monkeypatch.setattr(project_opentofu.jobs_service, "stream_job_events", _fake_stream_job_events)

    request = _FakeRequest(disconnect_after_calls=1)
    response = await project_opentofu.opentofu_apply_stream(
        project_opentofu.OpenTofuApplyBody(selected_modules=["network"]),
        request=request,
        project=SimpleNamespace(id="project-1", user_id="user-1"),
    )
    chunks = await _collect_stream_payloads(response)

    assert len(chunks) == 1
    assert '{"type":"deploy.start"}' in chunks[0]
