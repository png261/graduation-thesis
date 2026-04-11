"""Config-backed DeepAgent runtime discovery."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

CONFIG_MOUNT_PATH = "/.agent-config"
DEFAULT_CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"


@dataclass(frozen=True)
class AgentRuntimeConfig:
    config_dir: Path
    cache_token: str
    memory_paths: list[str]
    skill_paths: list[str]
    skills: list[dict[str, str]]
    subagents: list[dict[str, Any]]


def _skill_dirs(root: Path) -> list[Path]:
    if not root.is_dir():
        return []
    return sorted(path for path in root.iterdir() if path.is_dir() and (path / "SKILL.md").is_file())


def _relative_config_path(path: Path, config_dir: Path) -> str:
    return f"{CONFIG_MOUNT_PATH}/{path.relative_to(config_dir).as_posix()}"


def _relative_directory_path(path: Path, config_dir: Path) -> str:
    return f"{_relative_config_path(path, config_dir)}/"


def _config_cache_token(config_dir: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(node for node in config_dir.rglob("*") if node.is_file()):
        digest.update(path.relative_to(config_dir).as_posix().encode("utf-8"))
        digest.update(path.read_bytes())
    return digest.hexdigest()


def _split_frontmatter(contents: str) -> tuple[dict[str, str | list[str]], str]:
    lines = contents.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, contents.strip()

    closing_index = next((idx for idx, raw in enumerate(lines[1:], start=1) if raw.strip() == "---"), None)
    if closing_index is None:
        return {}, contents.strip()

    meta: dict[str, str | list[str]] = {}
    current_list_key: str | None = None
    for raw in lines[1:closing_index]:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("- ") and current_list_key:
            values = meta.setdefault(current_list_key, [])
            if isinstance(values, list):
                values.append(line[2:].strip().strip('"').strip("'"))
            continue
        if ":" not in line:
            current_list_key = None
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if value:
            meta[key] = value
            current_list_key = None
            continue
        meta[key] = []
        current_list_key = key

    body = "\n".join(lines[closing_index + 1 :]).strip()
    return meta, body


def _meta_text(meta: dict[str, str | list[str]], key: str, fallback: str = "") -> str:
    value = meta.get(key)
    return value.strip() if isinstance(value, str) else fallback


def _meta_list(meta: dict[str, str | list[str]], key: str) -> list[str]:
    value = meta.get(key)
    if isinstance(value, list):
        return [item.strip() for item in value if item.strip()]
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    return []


def _resolve_skill_path(raw: str, candidate: Path, config_dir: Path) -> str | None:
    if raw in {"./skills", "./skills/", "local"}:
        skill_root = candidate / "skills"
        return _relative_directory_path(skill_root, config_dir) if _skill_dirs(skill_root) else None
    if raw.startswith("/"):
        return raw
    skill_root = config_dir / "skills" / raw
    return _relative_directory_path(skill_root, config_dir) if (skill_root / "SKILL.md").is_file() else None


def _load_skill(candidate: Path, config_dir: Path) -> dict[str, str] | None:
    skill_file = candidate / "SKILL.md"
    if not skill_file.is_file():
        return None
    meta, _ = _split_frontmatter(skill_file.read_text(encoding="utf-8"))
    name = _meta_text(meta, "name", candidate.name)
    if not name:
        return None
    return {
        "name": name,
        "description": _meta_text(meta, "description", f"Skill {name}"),
        "path": _relative_directory_path(candidate, config_dir),
    }


def _subagent_skill_paths(candidate: Path, config_dir: Path, meta: dict[str, str | list[str]]) -> list[str]:
    resolved: list[str] = []
    for raw in _meta_list(meta, "skills"):
        skill_path = _resolve_skill_path(raw, candidate, config_dir)
        if skill_path and skill_path not in resolved:
            resolved.append(skill_path)
    local_root = candidate / "skills"
    local_path = _relative_directory_path(local_root, config_dir)
    if _skill_dirs(local_root) and local_path not in resolved:
        resolved.append(local_path)
    return resolved


def _load_subagent(candidate: Path, config_dir: Path) -> dict[str, Any] | None:
    agent_file = candidate / "AGENTS.md"
    if not agent_file.is_file():
        return None
    meta, body = _split_frontmatter(agent_file.read_text(encoding="utf-8"))
    name = _meta_text(meta, "name", candidate.name)
    if not name:
        return None

    spec: dict[str, Any] = {
        "name": name,
        "description": _meta_text(meta, "description", f"Subagent {name}"),
        "system_prompt": body,
    }
    model = _meta_text(meta, "model")
    if model:
        spec["model"] = model
    skills = _subagent_skill_paths(candidate, config_dir, meta)
    if skills:
        spec["skills"] = skills
    return spec


def _load_subagents(config_dir: Path) -> list[dict[str, Any]]:
    subagents_root = config_dir / "subagents"
    if not subagents_root.is_dir():
        return []
    specs = [
        _load_subagent(candidate, config_dir) for candidate in sorted(subagents_root.iterdir()) if candidate.is_dir()
    ]
    return [spec for spec in specs if spec is not None]


def _load_skills(config_dir: Path) -> list[dict[str, str]]:
    skill_root = config_dir / "skills"
    loaded = [_load_skill(candidate, config_dir) for candidate in _skill_dirs(skill_root)]
    return [item for item in loaded if item is not None]


def _memory_paths(config_dir: Path) -> list[str]:
    memory_file = config_dir / "AGENTS.md"
    return [_relative_config_path(memory_file, config_dir)] if memory_file.is_file() else []


def _skill_paths(config_dir: Path) -> list[str]:
    skill_root = config_dir / "skills"
    return [_relative_directory_path(skill_root, config_dir)] if _skill_dirs(skill_root) else []


def load_runtime_config(config_dir: Path | None = None) -> AgentRuntimeConfig:
    root = config_dir or DEFAULT_CONFIG_DIR
    return AgentRuntimeConfig(
        config_dir=root,
        cache_token=_config_cache_token(root),
        memory_paths=_memory_paths(root),
        skill_paths=_skill_paths(root),
        skills=_load_skills(root),
        subagents=_load_subagents(root),
    )


def build_runtime_subagents(settings: Any, subagents: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not subagents:
        raise ValueError(f"No subagents found under {DEFAULT_CONFIG_DIR / 'subagents'}")
    if not settings.agent_async_subagents_enabled:
        return subagents

    graph_ids = settings.async_subagent_graph_ids()
    if not graph_ids:
        raise ValueError("AGENT_ASYNC_SUBAGENT_GRAPH_IDS is required when AGENT_ASYNC_SUBAGENTS_ENABLED is true")

    headers = settings.async_subagent_headers()
    compiled: list[dict[str, Any]] = []
    for item in subagents:
        name = str(item.get("name") or "").strip()
        graph_id = graph_ids.get(name) or graph_ids.get(name.replace("-", "_"))
        if not graph_id:
            raise ValueError(f"missing_async_subagent_graph_id:{name}")
        payload: dict[str, Any] = {
            "name": name,
            "description": str(item.get("description") or "").strip(),
            "graph_id": graph_id,
        }
        if settings.agent_async_subagents_url:
            payload["url"] = settings.agent_async_subagents_url
        if headers:
            payload["headers"] = headers
        compiled.append(payload)
    return compiled
