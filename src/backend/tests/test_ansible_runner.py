from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.services.ansible.runtime import runner


@pytest.mark.asyncio
async def test_run_playbook_stream_reports_missing_ansible(monkeypatch) -> None:
    monkeypatch.setattr(runner, "ansible_available", lambda: False)

    events = [
        event
        async for event in runner.run_playbook_stream(
            project_id="p1",
            settings=SimpleNamespace(),
            selected_modules=[],
        )
    ]

    assert events[0]["type"] == "error"
    assert events[0]["code"] == "tool_unavailable"
    assert events[-1]["type"] == "config.done"
    assert events[-1]["status"] == "failed"


@pytest.mark.asyncio
async def test_run_playbook_stream_reports_missing_key_path(monkeypatch) -> None:
    monkeypatch.setattr(runner, "ansible_available", lambda: True)
    monkeypatch.setattr(runner, "resolve_ssh_key_path", lambda _settings: None)

    events = [
        event
        async for event in runner.run_playbook_stream(
            project_id="p1",
            settings=SimpleNamespace(),
            selected_modules=[],
        )
    ]

    assert events[0]["type"] == "error"
    assert events[0]["code"] == "missing_key_path"
    assert events[-1]["type"] == "config.done"
    assert events[-1]["status"] == "failed"
