from __future__ import annotations

from app.services.agent.runtime.prompts import (
    INFRA_SUBAGENTS,
    PROMPT_BUNDLE,
    SYSTEM_PROMPT,
    _DEFAULT_AGENT_MD,
    build_prompt_bundle,
)


REQUIRED_SUBAGENT_KEYS = {"name", "description", "system_prompt"}


def test_prompt_bundle_has_required_top_level_values() -> None:
    bundle = build_prompt_bundle()
    assert bundle.system_prompt
    assert bundle.opentofu_subagents
    assert bundle.default_agent_md


def test_subagent_payload_shape_and_uniqueness() -> None:
    names: set[str] = set()
    for subagent in PROMPT_BUNDLE.opentofu_subagents:
        assert REQUIRED_SUBAGENT_KEYS.issubset(subagent)
        assert subagent["name"]
        assert subagent["description"]
        assert subagent["system_prompt"]
        names.add(subagent["name"])

    assert len(names) == len(PROMPT_BUNDLE.opentofu_subagents)


def test_opentofu_subagent_set_is_present() -> None:
    names = {subagent["name"] for subagent in PROMPT_BUNDLE.opentofu_subagents}
    assert {"opentofu-architect", "opentofu-coder", "opentofu-reviewer"}.issubset(names)


def test_system_prompt_keeps_required_policy_anchors() -> None:
    assert "TASKS.md" in PROMPT_BUNDLE.system_prompt
    assert "delegate" in PROMPT_BUNDLE.system_prompt.lower()
    assert "opentofu-architect" in PROMPT_BUNDLE.system_prompt


def test_compatibility_aliases_match_bundle() -> None:
    assert SYSTEM_PROMPT == PROMPT_BUNDLE.system_prompt
    assert _DEFAULT_AGENT_MD == PROMPT_BUNDLE.default_agent_md
    assert len(INFRA_SUBAGENTS) == len(PROMPT_BUNDLE.opentofu_subagents)
