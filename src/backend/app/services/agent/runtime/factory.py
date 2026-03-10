"""Deep agent factory and cache lifecycle."""
from __future__ import annotations

import os
from typing import Any

from sqlalchemy import select

from langgraph.graph.state import CompiledStateGraph

from deepagents import create_deep_agent
from deepagents.backends import FilesystemBackend

from app import db
from app.core.config import Settings
from app.models import Project
from app.services.project import credentials as project_credentials
from app.services.project import files as project_files
from app.services.model.factory import create_chat_model

from .prompts import OPENTOFU_SUBAGENTS, SYSTEM_PROMPT
from .tools import build_project_tools

_agents: dict[str, CompiledStateGraph] = {}


def invalidate_agent(project_id: str) -> None:
    """Evict all cached agents for *project_id* so they rebuild on next call."""
    suffix = f":{project_id}"
    for key in [cache_key for cache_key in _agents if cache_key.endswith(suffix)]:
        del _agents[key]


async def _load_provider_context(project_id: str) -> str:
    """Return a system-prompt section describing the project's cloud provider and credentials."""
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

        creds = project_credentials.parse_credentials(project.credentials)
        if creds:
            lines.append("Credentials available:")
            for key, value in creds.items():
                if value:
                    lines.append(f"  - {key}: {value}")
            if project.provider == "aws":
                lines.append(
                    "\nUse these values in the OpenTofu AWS provider block "
                    "(access_key, secret_key, region)."
                )
            elif project.provider == "gcloud":
                lines.append(
                    "\nUse these values in the OpenTofu Google provider block "
                    "(project, region, credentials)."
                )
        else:
            lines.append("No credentials configured yet — the user may add them via project settings.")

        return "\n".join(lines)
    except Exception:
        return ""


async def get_agent(settings: Settings, project_id: str = "default") -> CompiledStateGraph:
    """Return (cached) an agent whose filesystem is scoped to local project directory."""
    if not settings.google_api_key:
        raise ValueError("GOOGLE_API_KEY is not set")

    cache_key = f"{settings.google_api_key}:{settings.gemini_model}:{project_id}"

    if cache_key not in _agents:
        if "GOOGLE_API_KEY" not in os.environ:
            os.environ["GOOGLE_API_KEY"] = settings.google_api_key
        elif os.environ.get("GOOGLE_API_KEY") != settings.google_api_key:
            os.environ["GOOGLE_API_KEY"] = settings.google_api_key

        model = create_chat_model(settings)

        provider_ctx = await _load_provider_context(project_id)
        full_system_prompt = SYSTEM_PROMPT + (f"\n\n{provider_ctx}" if provider_ctx else "")

        pid = project_id
        project_root = project_files.ensure_project_dir(pid)

        def _backend_factory(_: Any) -> FilesystemBackend:
            return FilesystemBackend(root_dir=project_root, virtual_mode=True)

        _agents[cache_key] = create_deep_agent(
            tools=build_project_tools(settings, pid),
            system_prompt=full_system_prompt,
            model=model,
            checkpointer=db.get_checkpointer(),
            store=None,
            memory=["/AGENT.md"],
            skills=["/skills/"],
            subagents=OPENTOFU_SUBAGENTS,
            backend=_backend_factory,
        )

    return _agents[cache_key]
