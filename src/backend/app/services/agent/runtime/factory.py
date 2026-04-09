"""Deep agent factory and cache lifecycle."""

from __future__ import annotations

from typing import Any

from deepagents import create_deep_agent
from deepagents.backends import FilesystemBackend
from langgraph.graph.state import CompiledStateGraph
from sqlalchemy import select

from app import db
from app.core.config import Settings
from app.models import Project
from app.services.model.factory import create_chat_model, get_agent_store
from app.services.project import files as project_files

from .context import DeepAgentContext
from .iac_templates import provider_credential_vars
from .prompts import (
    PROMPT_BUNDLE,
    build_async_infra_subagents,
    build_context_engineering_middleware,
)
from .tools import build_project_tools

_agents: dict[str, CompiledStateGraph] = {}


def invalidate_agent(project_id: str) -> None:
    """Evict all cached agents for *project_id* so they rebuild on next call."""
    suffix = f":{project_id}"
    for key in [cache_key for cache_key in _agents if cache_key.endswith(suffix)]:
        del _agents[key]


def clear_agent_cache() -> None:
    _agents.clear()


def _build_runtime_subagents(settings: Settings) -> list[dict[str, Any]]:
    if not settings.agent_async_subagents_enabled:
        return [dict(item) for item in PROMPT_BUNDLE.infra_subagents]
    graph_ids = settings.async_subagent_graph_ids()
    if not graph_ids:
        raise ValueError(
            "AGENT_ASYNC_SUBAGENT_GRAPH_IDS is required when AGENT_ASYNC_SUBAGENTS_ENABLED is true",
        )
    return [
        dict(item)
        for item in build_async_infra_subagents(
            graph_ids,
            url=settings.agent_async_subagents_url,
            headers=settings.async_subagent_headers(),
        )
    ]


async def _load_provider_context(project_id: str) -> str:
    """Return a system-prompt section describing provider and variable-only credential usage."""
    try:
        async with db.get_session() as session:
            result = await session.execute(select(Project).where(Project.id == project_id))
            project = result.scalar_one_or_none()

        if project is None or not project.provider:
            return ""

        provider_label = {
            "aws": "AWS (Amazon Web Services)",
            "gcloud": "Google Cloud Platform",
        }.get(project.provider, project.provider)
        lines = [f"## Cloud Provider\nProvider: {provider_label}"]
        lines.append("Never include raw credentials in code or prompts. Use Terraform variables only.")
        vars_by_provider = provider_credential_vars(project.provider)
        if vars_by_provider:
            lines.append("Credential variables to reference:")
            lines.extend(f"  - var.{name}" for name in vars_by_provider)

        return "\n".join(lines)
    except Exception:
        return ""


async def get_agent(settings: Settings, project_id: str = "default") -> CompiledStateGraph:
    """Return (cached) an agent whose filesystem is scoped to local project directory."""
    if not settings.llm_api_key:
        raise ValueError("LLM_API_KEY is not set")
    if not settings.llm_model:
        raise ValueError("LLM_MODEL is not set")

    cache_key = (
        f"{settings.llm_base_url}:{settings.llm_api_key}:{settings.llm_model}:"
        f"{int(settings.opentofu_mcp_enabled)}:{settings.opentofu_mcp_url}:"
        f"{int(settings.agent_async_subagents_enabled)}:{settings.agent_async_subagents_url}:"
        f"{settings.agent_async_subagents_graph_ids}:{settings.agent_async_subagents_headers}:{project_id}"
    )

    if cache_key in _agents:
        return _agents[cache_key]

    model = create_chat_model(settings)
    store = await get_agent_store(settings)
    provider_ctx = await _load_provider_context(project_id)
    full_system_prompt = PROMPT_BUNDLE.system_prompt + (f"\n\n{provider_ctx}" if provider_ctx else "")
    pid = project_id
    project_root = project_files.ensure_project_dir(pid)
    tools, mcp_ready = await build_project_tools(settings, pid)
    subagents = _build_runtime_subagents(settings)

    def _backend_factory(_: Any) -> FilesystemBackend:
        return FilesystemBackend(root_dir=project_root, virtual_mode=True)

    agent = create_deep_agent(
        tools=tools,
        system_prompt=full_system_prompt,
        middleware=build_context_engineering_middleware(int(settings.incident_token_budget or 16000)),
        model=model,
        checkpointer=db.get_checkpointer(),
        store=store,
        memory=["/AGENT.md"],
        subagents=subagents,
        context_schema=DeepAgentContext,
        backend=_backend_factory,
    )

    if settings.opentofu_mcp_enabled and not mcp_ready:
        return agent
    _agents[cache_key] = agent
    return _agents[cache_key]
