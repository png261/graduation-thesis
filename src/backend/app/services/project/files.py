"""Local filesystem storage for project-scoped files."""
from __future__ import annotations

import re
import shutil
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

PROJECTS_ROOT = Path(__file__).resolve().parents[2] / "projects"
_VALID_PROJECT_ID = re.compile(r"^[A-Za-z0-9._-]+$")


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def _validate_project_id(project_id: str) -> str:
    value = (project_id or "").strip()
    if not value or not _VALID_PROJECT_ID.match(value):
        raise ValueError("Invalid project id")
    return value


def normalize_virtual_path(path: str) -> str:
    """Normalize API path to rooted POSIX path and reject traversal."""
    raw = (path or "").strip()
    if not raw:
        raise ValueError("Path is required")
    if "\x00" in raw:
        raise ValueError("Invalid path")
    rooted = raw if raw.startswith("/") else f"/{raw}"
    posix = PurePosixPath(rooted)
    if any(part in {"..", "."} for part in posix.parts):
        raise ValueError("Path traversal is not allowed")
    return str(posix)


def project_dir(project_id: str) -> Path:
    pid = _validate_project_id(project_id)
    return PROJECTS_ROOT / pid


def ensure_project_dir(project_id: str) -> Path:
    root = project_dir(project_id)
    root.mkdir(parents=True, exist_ok=True)
    return root


def resolve(project_id: str, virtual_path: str) -> Path:
    norm = normalize_virtual_path(virtual_path)
    root = ensure_project_dir(project_id)
    rel = norm.lstrip("/")
    target = root / rel
    resolved = target.resolve()
    root_resolved = root.resolve()
    if resolved != root_resolved and root_resolved not in resolved.parents:
        raise ValueError("Resolved path escapes project root")
    return target


def list_files(project_id: str) -> list[dict[str, Any]]:
    root = ensure_project_dir(project_id)
    files: list[dict[str, Any]] = []
    for file_path in root.rglob("*"):
        if not file_path.is_file():
            continue
        rel = "/" + file_path.relative_to(root).as_posix()
        stat = file_path.stat()
        files.append(
            {
                "path": rel,
                "size": stat.st_size,
                "modifiedAt": _iso(stat.st_mtime),
                "createdAt": _iso(stat.st_ctime),
            }
        )
    files.sort(key=lambda item: item["path"])
    return files


def read_text(project_id: str, virtual_path: str) -> str:
    file_path = resolve(project_id, virtual_path)
    if not file_path.exists() or not file_path.is_file():
        raise FileNotFoundError(str(file_path))
    return file_path.read_text()


def write_text(project_id: str, virtual_path: str, content: str) -> str:
    file_path = resolve(project_id, virtual_path)
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(content)
    return normalize_virtual_path(virtual_path)


def delete_file(project_id: str, virtual_path: str) -> str:
    file_path = resolve(project_id, virtual_path)
    if not file_path.exists() or not file_path.is_file():
        raise FileNotFoundError(str(file_path))
    file_path.unlink()
    return normalize_virtual_path(virtual_path)


def delete_project_dir(project_id: str) -> None:
    root = project_dir(project_id)
    if root.exists():
        shutil.rmtree(root)


def ensure_default_agent_memory(project_id: str, content: str) -> None:
    root = ensure_project_dir(project_id)
    memory_path = root / "AGENT.md"
    if not memory_path.exists():
        memory_path.write_text(content)


def iter_skill_files(project_id: str) -> list[tuple[str, str]]:
    root = ensure_project_dir(project_id)
    skills_root = root / "skills"
    if not skills_root.exists():
        return []
    items: list[tuple[str, str]] = []
    for skill_md in skills_root.glob("*/SKILL.md"):
        if not skill_md.is_file():
            continue
        skill_name = skill_md.parent.name
        items.append((skill_name, skill_md.read_text()))
    items.sort(key=lambda item: item[0])
    return items

