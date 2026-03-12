from __future__ import annotations

import pytest

from app.services.jobs.errors import JobValidationError
from app.services.jobs.validation import parse_job_payload


def test_parse_payload_accepts_valid_body() -> None:
    parsed = parse_job_payload(
        "pipeline",
        {
            "selected_modules": ["vpc", "app"],
            "intent": "deploy",
            "options": {"refresh": True},
        },
    )
    assert parsed["selected_modules"] == ["vpc", "app"]
    assert parsed["intent"] == "deploy"
    assert parsed["options"] == {"refresh": True}


def test_parse_chat_payload_accepts_valid_body() -> None:
    parsed = parse_job_payload(
        "chat",
        {
            "project_id": "project-1",
            "thread_id": "thread-1",
            "messages": [{"role": "user", "content": "hello"}],
            "options": {"notify_telegram": True},
        },
    )
    assert parsed["project_id"] == "project-1"
    assert parsed["thread_id"] == "thread-1"
    assert parsed["messages"] == [{"role": "user", "content": "hello"}]
    assert parsed["options"] == {"notify_telegram": True}


@pytest.mark.parametrize(
    "body",
    [
        {"selected_modules": "vpc"},
        {"selected_modules": ["vpc", 1]},
        {"selected_modules": ["vpc"], "options": "bad"},
        {"selected_modules": ["vpc"], "intent": 1},
    ],
)
def test_parse_payload_rejects_invalid_shape(body: dict) -> None:
    with pytest.raises(JobValidationError):
        parse_job_payload("apply", body)


@pytest.mark.parametrize(
    "body",
    [
        {"project_id": "", "messages": [{"role": "user", "content": "hello"}]},
        {"project_id": "project-1", "messages": []},
        {"project_id": "project-1", "messages": [{"role": "tool", "content": "x"}]},
        {"project_id": "project-1", "messages": [{"role": "user", "content": 1}]},
        {"project_id": "project-1", "messages": "bad"},
    ],
)
def test_parse_chat_payload_rejects_invalid_shape(body: dict) -> None:
    with pytest.raises(JobValidationError):
        parse_job_payload("chat", body)


def test_parse_payload_rejects_unsupported_kind() -> None:
    with pytest.raises(JobValidationError):
        parse_job_payload("unknown", {"selected_modules": []})
