"""Compatibility facade for agent runtime internals."""
from __future__ import annotations

from app import db
from app.services.github import auth as github_auth
from app.services.github import projects as github_projects
from app.services.opentofu import deploy as opentofu_deploy
from app.services.agent.runtime.factory import get_agent, invalidate_agent
from app.services.agent.runtime.prompts import OPENTOFU_SUBAGENTS, SYSTEM_PROMPT, _DEFAULT_AGENT_MD
from app.services.agent.runtime.tools import (
    _github_tool_create_pull_request,
    _opentofu_tool_apply,
    _opentofu_tool_preview,
    build_project_tools as _build_project_tools,
)

__all__ = [
    "SYSTEM_PROMPT",
    "OPENTOFU_SUBAGENTS",
    "_DEFAULT_AGENT_MD",
    "invalidate_agent",
    "get_agent",
    "_opentofu_tool_preview",
    "_opentofu_tool_apply",
    "_github_tool_create_pull_request",
    "_build_project_tools",
    "db",
    "github_auth",
    "github_projects",
    "opentofu_deploy",
]
