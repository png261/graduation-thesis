"""Deep agent factory and cache lifecycle."""

from __future__ import annotations

from typing import Any

from deepagents import create_deep_agent
from deepagents.backends import CompositeBackend, FilesystemBackend
from deepagents.backends.protocol import EditResult, FileUploadResponse, WriteResult
from langgraph.graph.state import CompiledStateGraph

from app import db
from app.core.config import Settings
from app.services.model.factory import create_chat_model, get_agent_store
from app.services.project import files as project_files

from .config_loader import CONFIG_MOUNT_PATH, AgentRuntimeConfig, build_runtime_subagents, load_runtime_config
from .context import DeepAgentContext
from .tools import build_project_tools

_agents: dict[str, CompiledStateGraph] = {}
_RUNTIME_SYSTEM_PROMPT = """
Follow the user's request directly.

Use config-backed memory, skills, and subagents progressively:
- Do not inspect `/.agent-config/` or enumerate every skill before starting.
- Rely on the registered skill list first and open only the minimal `SKILL.md` files that clearly match the current task.
- Read a subagent's prompt only when you are about to delegate to that subagent.
"""


class _ReadOnlyFilesystemBackend(FilesystemBackend):
    def _write_blocked(self, path: str) -> str:
        return f"Error: '{path}' is part of the internal agent config and is read-only."

    def write(self, file_path: str, content: str) -> WriteResult:
        return WriteResult(error=self._write_blocked(file_path))

    async def awrite(self, file_path: str, content: str) -> WriteResult:
        return self.write(file_path, content)

    def edit(
        self,
        file_path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,
    ) -> EditResult:
        return EditResult(error=self._write_blocked(file_path))

    async def aedit(
        self,
        file_path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,
    ) -> EditResult:
        return self.edit(file_path, old_string, new_string, replace_all=replace_all)

    def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
        return [FileUploadResponse(path=path, error="permission_denied") for path, _ in files]


def _runtime_backend(project_root: str, config_root: str) -> CompositeBackend:
    return CompositeBackend(
        default=FilesystemBackend(root_dir=project_root, virtual_mode=True),
        routes={
            f"{CONFIG_MOUNT_PATH}/": _ReadOnlyFilesystemBackend(
                root_dir=config_root,
                virtual_mode=True,
            ),
        },
    )


def invalidate_agent(project_id: str) -> None:
    """Evict all cached agents for *project_id* so they rebuild on next call."""
    suffix = f":{project_id}"
    for key in [cache_key for cache_key in _agents if cache_key.endswith(suffix)]:
        del _agents[key]


def clear_agent_cache() -> None:
    _agents.clear()


def _single_line(text: str, limit: int = 140) -> str:
    compact = " ".join(text.split())
    return compact if len(compact) <= limit else f"{compact[: limit - 3].rstrip()}..."


def _catalog_lines(title: str, items: list[str]) -> list[str]:
    if not items:
        return []
    return ["", title, *[f"- {item}" for item in items]]


def _skill_lines(runtime_config: AgentRuntimeConfig | None) -> list[str]:
    if runtime_config is None:
        return []
    return [f"{item['name']}: {_single_line(item['description'])}" for item in runtime_config.skills]


def _subagent_lines(runtime_config: AgentRuntimeConfig | None) -> list[str]:
    if runtime_config is None:
        return []
    return [
        f"{str(item.get('name') or '').strip()}: {_single_line(str(item.get('description') or ''))}"
        for item in runtime_config.subagents
        if str(item.get("name") or "").strip()
    ]


def _tool_lines(tools: list[Any] | None) -> list[str]:
    if not tools:
        return []
    lines: list[str] = []
    for tool in tools:
        name = str(getattr(tool, "name", "") or "").strip()
        if not name:
            continue
        description = _single_line(str(getattr(tool, "description", "") or "Tool available in this session."))
        lines.append(f"{name}: {description}")
    return lines


def _runtime_system_prompt(
    runtime_config: AgentRuntimeConfig | None = None,
    tools: list[Any] | None = None,
) -> str:
    sections = [_RUNTIME_SYSTEM_PROMPT.strip(), "", "Available capabilities in this session:"]
    sections.extend(_catalog_lines("Skills:", _skill_lines(runtime_config)))
    sections.extend(_catalog_lines("Tools:", _tool_lines(tools)))
    sections.extend(_catalog_lines("Subagents:", _subagent_lines(runtime_config)))
    return "\n".join(sections).strip()


async def get_agent(settings: Settings, project_id: str = "default") -> CompiledStateGraph:
    """Return (cached) an agent whose filesystem is scoped to local project directory."""
    if not settings.llm_api_key:
        raise ValueError("LLM_API_KEY is not set")
    if not settings.llm_model:
        raise ValueError("LLM_MODEL is not set")

    runtime_config = load_runtime_config()
    cache_key = (
        f"{settings.llm_base_url}:{settings.llm_api_key}:{settings.llm_model}:"
        f"{int(settings.opentofu_mcp_enabled)}:{settings.opentofu_mcp_url}:"
        f"{int(settings.agent_async_subagents_enabled)}:{settings.agent_async_subagents_url}:"
        f"{settings.agent_async_subagents_graph_ids}:{settings.agent_async_subagents_headers}:"
        f"{runtime_config.cache_token}:{project_id}"
    )

    if cache_key in _agents:
        return _agents[cache_key]

    model = create_chat_model(settings)
    store = await get_agent_store(settings)
    pid = project_id
    project_root = project_files.ensure_project_dir(pid)
    tools, mcp_ready = await build_project_tools(settings, pid)
    backend = _runtime_backend(str(project_root), str(runtime_config.config_dir))

    agent = create_deep_agent(
        tools=tools,
        system_prompt=_runtime_system_prompt(runtime_config, tools),
        model=model,
        checkpointer=db.get_checkpointer(),
        store=store,
        memory=runtime_config.memory_paths,
        subagents=build_runtime_subagents(settings, runtime_config.subagents),
        skills=runtime_config.skill_paths,
        context_schema=DeepAgentContext,
        backend=backend,
    )

    if settings.opentofu_mcp_enabled and not mcp_ready:
        return agent
    _agents[cache_key] = agent
    return _agents[cache_key]
