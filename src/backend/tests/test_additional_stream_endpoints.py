from __future__ import annotations

from types import SimpleNamespace
from typing import Any, AsyncIterator

import pytest

from app.routers.projects_routes import project_ansible, project_jobs, project_opentofu
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


async def _collect_chunks(response) -> list[str]:
    chunks: list[str] = []
    async for payload in response.body_iterator:
        chunks.append(payload.decode("utf-8") if isinstance(payload, bytes) else str(payload))
    return chunks


@pytest.mark.asyncio
async def test_plan_stream_emits_job_events(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    async def _fake_enqueue(*, project, kind, payload):
        captured["kind"] = kind
        captured["payload"] = payload
        return {"id": "job-1"}

    async def _fake_stream(**_kwargs) -> AsyncIterator[str]:
        yield 'data: {"type":"plan.start"}\n\n'
        yield 'data: {"type":"plan.done","status":"ok"}\n\n'

    monkeypatch.setattr(project_opentofu.jobs_service, "enqueue_project_job", _fake_enqueue)
    monkeypatch.setattr(project_opentofu.jobs_service, "stream_job_events", _fake_stream)

    response = await project_opentofu.opentofu_plan_stream(
        project_opentofu.OpenTofuApplyBody(selected_modules=["core"], intent="plan core"),
        request=_FakeRequest(),
        project=SimpleNamespace(id="project-1", user_id="user-1"),
    )
    chunks = await _collect_chunks(response)

    assert len(chunks) == 2
    assert '"type":"plan.start"' in chunks[0]
    assert '"status":"ok"' in chunks[1]
    assert captured["kind"] == "plan"
    assert captured["payload"]["options"] == {}


@pytest.mark.asyncio
async def test_plan_stream_emits_error_event_on_jobs_error(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _raise_jobs_error(*, project, kind, payload):
        raise JobConflictError()

    async def _unused_stream(**_kwargs) -> AsyncIterator[str]:
        if False:
            yield ""

    monkeypatch.setattr(project_opentofu.jobs_service, "enqueue_project_job", _raise_jobs_error)
    monkeypatch.setattr(project_opentofu.jobs_service, "stream_job_events", _unused_stream)

    response = await project_opentofu.opentofu_plan_stream(
        project_opentofu.OpenTofuApplyBody(selected_modules=[]),
        request=_FakeRequest(),
        project=SimpleNamespace(id="project-1", user_id="user-1"),
    )
    chunks = await _collect_chunks(response)

    assert len(chunks) == 1
    assert '"type": "error"' in chunks[0]
    assert '"code": "job_conflict"' in chunks[0]


@pytest.mark.asyncio
async def test_plan_stream_stops_on_disconnect(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake_enqueue(*, project, kind, payload):
        return {"id": "job-1"}

    async def _fake_stream(**_kwargs) -> AsyncIterator[str]:
        yield 'data: {"type":"plan.start"}\n\n'
        yield 'data: {"type":"log","line":"step-2"}\n\n'
        yield 'data: {"type":"plan.done","status":"ok"}\n\n'

    monkeypatch.setattr(project_opentofu.jobs_service, "enqueue_project_job", _fake_enqueue)
    monkeypatch.setattr(project_opentofu.jobs_service, "stream_job_events", _fake_stream)

    response = await project_opentofu.opentofu_plan_stream(
        project_opentofu.OpenTofuApplyBody(selected_modules=["core"]),
        request=_FakeRequest(disconnect_after_calls=1),
        project=SimpleNamespace(id="project-1", user_id="user-1"),
    )
    chunks = await _collect_chunks(response)

    assert len(chunks) == 1
    assert '"type":"plan.start"' in chunks[0]


@pytest.mark.asyncio
async def test_ansible_stream_emits_job_events(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    async def _fake_enqueue(*, project, kind, payload):
        captured["kind"] = kind
        captured["payload"] = payload
        return {"id": "job-ansible"}

    async def _fake_stream(**_kwargs) -> AsyncIterator[str]:
        yield 'data: {"type":"config.start"}\n\n'
        yield 'data: {"type":"config.done","status":"ok"}\n\n'

    monkeypatch.setattr(project_ansible.jobs_service, "enqueue_project_job", _fake_enqueue)
    monkeypatch.setattr(project_ansible.jobs_service, "stream_job_events", _fake_stream)

    response = await project_ansible.ansible_run_stream(
        project_ansible.AnsibleRunBody(selected_modules=["core"], intent="configure core"),
        request=_FakeRequest(),
        project=SimpleNamespace(id="project-1", user_id="user-1"),
    )
    chunks = await _collect_chunks(response)

    assert len(chunks) == 2
    assert '"type":"config.start"' in chunks[0]
    assert '"status":"ok"' in chunks[1]
    assert captured["kind"] == "ansible"
    assert captured["payload"]["options"] == {}


@pytest.mark.asyncio
async def test_ansible_stream_emits_error_event_on_jobs_error(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _raise_jobs_error(*, project, kind, payload):
        raise JobConflictError()

    async def _unused_stream(**_kwargs) -> AsyncIterator[str]:
        if False:
            yield ""

    monkeypatch.setattr(project_ansible.jobs_service, "enqueue_project_job", _raise_jobs_error)
    monkeypatch.setattr(project_ansible.jobs_service, "stream_job_events", _unused_stream)

    response = await project_ansible.ansible_run_stream(
        project_ansible.AnsibleRunBody(selected_modules=[]),
        request=_FakeRequest(),
        project=SimpleNamespace(id="project-1", user_id="user-1"),
    )
    chunks = await _collect_chunks(response)

    assert len(chunks) == 1
    assert '"type": "error"' in chunks[0]
    assert '"code": "job_conflict"' in chunks[0]


@pytest.mark.asyncio
async def test_ansible_stream_stops_on_disconnect(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake_enqueue(*, project, kind, payload):
        return {"id": "job-ansible"}

    async def _fake_stream(**_kwargs) -> AsyncIterator[str]:
        yield 'data: {"type":"config.start"}\n\n'
        yield 'data: {"type":"log","line":"step-2"}\n\n'
        yield 'data: {"type":"config.done","status":"ok"}\n\n'

    monkeypatch.setattr(project_ansible.jobs_service, "enqueue_project_job", _fake_enqueue)
    monkeypatch.setattr(project_ansible.jobs_service, "stream_job_events", _fake_stream)

    response = await project_ansible.ansible_run_stream(
        project_ansible.AnsibleRunBody(selected_modules=["core"]),
        request=_FakeRequest(disconnect_after_calls=1),
        project=SimpleNamespace(id="project-1", user_id="user-1"),
    )
    chunks = await _collect_chunks(response)

    assert len(chunks) == 1
    assert '"type":"config.start"' in chunks[0]


@pytest.mark.asyncio
async def test_jobs_events_stream_emits_payloads(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    async def _fake_stream(**kwargs) -> AsyncIterator[str]:
        captured["kwargs"] = kwargs
        yield 'data: {"type":"job.running"}\n\n'
        yield 'data: {"type":"job.terminal","status":"succeeded"}\n\n'

    monkeypatch.setattr(project_jobs.jobs_service, "stream_job_events", _fake_stream)

    response = await project_jobs.stream_job_events(
        "job-1",
        request=_FakeRequest(),
        from_seq=4,
        project=SimpleNamespace(id="project-1", user_id="user-1"),
    )
    chunks = await _collect_chunks(response)

    assert len(chunks) == 2
    assert '"type":"job.running"' in chunks[0]
    assert '"status":"succeeded"' in chunks[1]
    assert captured["kwargs"]["job_id"] == "job-1"
    assert captured["kwargs"]["from_seq"] == 4


@pytest.mark.asyncio
async def test_jobs_events_stream_emits_error_event_on_jobs_error(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _raise_jobs_error(**_kwargs):
        raise JobConflictError()
        if False:
            yield ""

    monkeypatch.setattr(project_jobs.jobs_service, "stream_job_events", _raise_jobs_error)

    response = await project_jobs.stream_job_events(
        "job-1",
        request=_FakeRequest(),
        from_seq=0,
        project=SimpleNamespace(id="project-1", user_id="user-1"),
    )
    chunks = await _collect_chunks(response)

    assert len(chunks) == 1
    assert '"type": "error"' in chunks[0]
    assert '"code": "job_conflict"' in chunks[0]


@pytest.mark.asyncio
async def test_jobs_events_stream_stops_when_request_disconnects(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake_stream(**kwargs) -> AsyncIterator[str]:
        request = kwargs["request"]
        yield 'data: {"type":"job.running"}\n\n'
        if await request.is_disconnected():
            return
        yield 'data: {"type":"job.terminal","status":"succeeded"}\n\n'

    monkeypatch.setattr(project_jobs.jobs_service, "stream_job_events", _fake_stream)

    response = await project_jobs.stream_job_events(
        "job-1",
        request=_FakeRequest(disconnect_after_calls=0),
        from_seq=0,
        project=SimpleNamespace(id="project-1", user_id="user-1"),
    )
    chunks = await _collect_chunks(response)

    assert len(chunks) == 1
    assert '"type":"job.running"' in chunks[0]
