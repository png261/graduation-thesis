from __future__ import annotations

import pytest

from app.services.opentofu.runtime import runner


@pytest.mark.asyncio
async def test_policy_gate_blocks_apply_when_high_severity_exists(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _fake_checks(_project_id: str) -> dict:
        return {
            "issues": [
                {"severity": "LOW", "message": "minor"},
                {"severity": "HIGH", "message": "critical policy issue"},
            ],
            "summary": {"total": 2, "bySeverity": {"LOW": 1, "HIGH": 1}},
            "scanError": None,
        }

    monkeypatch.setattr(runner.policy_checks, "run_project_policy_checks", _fake_checks)
    events = await runner._policy_gate_failure_events("project-1", "deploy")

    assert events is not None
    assert events[0]["type"] == "policy.check.result"
    assert events[1]["type"] == "error"
    assert events[1]["code"] == "policy_gate_blocked"
    assert events[2]["type"] == "deploy.done"
    assert events[2]["status"] == "failed"


@pytest.mark.asyncio
async def test_policy_gate_allows_apply_without_blocking_issues(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _fake_checks(_project_id: str) -> dict:
        return {
            "issues": [{"severity": "LOW", "message": "minor"}],
            "summary": {"total": 1, "bySeverity": {"LOW": 1}},
            "scanError": None,
        }

    monkeypatch.setattr(runner.policy_checks, "run_project_policy_checks", _fake_checks)
    events = await runner._policy_gate_failure_events("project-1", "deploy")
    assert events is None
