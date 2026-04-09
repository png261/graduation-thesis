"""Local filesystem storage for project-scoped files."""

from __future__ import annotations

import os
import re
import shutil
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

_DEFAULT_PROJECTS_ROOT = Path(__file__).resolve().parents[2] / "projects"
PROJECTS_ROOT = Path(os.getenv("PROJECTS_ROOT", str(_DEFAULT_PROJECTS_ROOT))).expanduser()
_VALID_PROJECT_ID = re.compile(r"^[A-Za-z0-9._-]+$")


class MoveConflictError(ValueError):
    """Raised when a move destination already exists or collides."""


@dataclass(frozen=True)
class _MovePlanItem:
    source_virtual: str
    source_abs: Path
    destination_virtual: str
    destination_abs: Path


@dataclass(frozen=True)
class _StagedMoveItem:
    plan: _MovePlanItem
    staged_abs: Path


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


def read_bytes(project_id: str, virtual_path: str) -> bytes:
    file_path = resolve(project_id, virtual_path)
    if not file_path.exists() or not file_path.is_file():
        raise FileNotFoundError(str(file_path))
    return file_path.read_bytes()


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


def _dedupe_paths(paths: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for path in paths:
        if path in seen:
            continue
        seen.add(path)
        ordered.append(path)
    return ordered


def _collapse_descendant_sources(entries: list[tuple[str, bool]]) -> list[str]:
    ordered = [path for path, _ in entries]
    folder_paths = [path for path, is_folder in entries if is_folder]
    excluded: set[str] = set()
    for folder in folder_paths:
        prefix = f"{folder}/"
        for candidate in ordered:
            if candidate != folder and candidate.startswith(prefix):
                excluded.add(candidate)
    return [path for path in ordered if path not in excluded]


def _destination_virtual_path(destination_dir: str, source_virtual_path: str) -> str:
    name = PurePosixPath(source_virtual_path).name
    if not name:
        raise ValueError(f"Invalid source path '{source_virtual_path}'")
    if destination_dir == "/":
        return normalize_virtual_path(f"/{name}")
    return normalize_virtual_path(f"{destination_dir}/{name}")


def _path_inside(path: str, container: str) -> bool:
    return path == container or path.startswith(f"{container}/")


def _validate_sources(project_id: str, source_paths: list[str]) -> list[tuple[str, Path, bool]]:
    normalized = _dedupe_paths([normalize_virtual_path(path) for path in source_paths])
    if not normalized:
        raise ValueError("source_paths must include at least one path")
    if any(path == "/" for path in normalized):
        raise ValueError("Project root cannot be moved")
    validated: list[tuple[str, Path, bool]] = []
    for path in normalized:
        source_abs = resolve(project_id, path)
        if not source_abs.exists():
            raise FileNotFoundError(f"Source path '{path}' not found")
        validated.append((path, source_abs, source_abs.is_dir()))
    collapsed = _collapse_descendant_sources([(path, is_dir) for path, _, is_dir in validated])
    collapsed_set = set(collapsed)
    return [item for item in validated if item[0] in collapsed_set]


def _build_move_plan(project_id: str, source_paths: list[str], destination_dir: str) -> list[_MovePlanItem]:
    sources = _validate_sources(project_id, source_paths)
    source_set = {source for source, _, _ in sources}
    destination_virtual = normalize_virtual_path(destination_dir)
    destination_abs = resolve(project_id, destination_virtual)
    if not destination_abs.exists() or not destination_abs.is_dir():
        raise FileNotFoundError(f"Destination directory '{destination_virtual}' not found")

    for source_virtual, _, is_dir in sources:
        if is_dir and _path_inside(destination_virtual, source_virtual):
            raise ValueError(f"Cannot move folder '{source_virtual}' into itself or a descendant")

    planned_destinations: set[str] = set()
    plan: list[_MovePlanItem] = []
    for source_virtual, source_abs, _ in sources:
        destination_item_virtual = _destination_virtual_path(destination_virtual, source_virtual)
        if destination_item_virtual == source_virtual:
            continue
        if destination_item_virtual in planned_destinations:
            raise MoveConflictError(f"Multiple sources resolve to destination '{destination_item_virtual}'")
        planned_destinations.add(destination_item_virtual)
        destination_item_abs = resolve(project_id, destination_item_virtual)
        if destination_item_virtual not in source_set and destination_item_abs.exists():
            raise MoveConflictError(f"Destination path '{destination_item_virtual}' already exists")
        plan.append(
            _MovePlanItem(
                source_virtual=source_virtual,
                source_abs=source_abs,
                destination_virtual=destination_item_virtual,
                destination_abs=destination_item_abs,
            )
        )
    return plan


def _rollback_staged_sources(staged: list[_StagedMoveItem]) -> None:
    for record in reversed(staged):
        if not record.staged_abs.exists():
            continue
        record.plan.source_abs.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(record.staged_abs), str(record.plan.source_abs))


def _rollback_applied_moves(applied: list[_StagedMoveItem]) -> None:
    for record in reversed(applied):
        if not record.plan.destination_abs.exists():
            continue
        record.plan.source_abs.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(record.plan.destination_abs), str(record.plan.source_abs))


def _stage_move_sources(plan: list[_MovePlanItem], staging_root: Path) -> list[_StagedMoveItem]:
    staged: list[_StagedMoveItem] = []
    for index, item in enumerate(plan):
        staged_abs = staging_root / str(index)
        shutil.move(str(item.source_abs), str(staged_abs))
        staged.append(_StagedMoveItem(plan=item, staged_abs=staged_abs))
    return staged


def _execute_move_plan(project_id: str, plan: list[_MovePlanItem]) -> list[dict[str, str]]:
    if not plan:
        return []

    root = ensure_project_dir(project_id)
    staging_root = Path(tempfile.mkdtemp(prefix=f".move-{project_id}-", dir=root.parent))
    staged: list[_StagedMoveItem] = []
    applied: list[_StagedMoveItem] = []
    try:
        staged = _stage_move_sources(plan, staging_root)
        for record in staged:
            record.plan.destination_abs.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(record.staged_abs), str(record.plan.destination_abs))
            applied.append(record)
    except Exception:
        _rollback_applied_moves(applied)
        _rollback_staged_sources(staged)
        raise
    finally:
        shutil.rmtree(staging_root, ignore_errors=True)

    return [{"from": item.source_virtual, "to": item.destination_virtual} for item in plan]


def move_paths(project_id: str, source_paths: list[str], destination_dir: str) -> list[dict[str, str]]:
    return _execute_move_plan(project_id, _build_move_plan(project_id, source_paths, destination_dir))


def rename_path(project_id: str, virtual_path: str, new_name: str) -> dict[str, str]:
    source_virtual = normalize_virtual_path(virtual_path)
    source_abs = resolve(project_id, source_virtual)
    if not source_abs.exists():
        raise FileNotFoundError(f"Source path '{source_virtual}' not found")

    candidate_name = (new_name or "").strip()
    if not candidate_name or "/" in candidate_name or candidate_name in {".", ".."}:
        raise ValueError("new_name must be a valid single path segment")

    source_parts = PurePosixPath(source_virtual).parts
    parent_virtual = "/" if len(source_parts) <= 2 else "/" + "/".join(source_parts[1:-1])
    destination_virtual = normalize_virtual_path(
        f"/{candidate_name}" if parent_virtual == "/" else f"{parent_virtual}/{candidate_name}"
    )
    destination_abs = resolve(project_id, destination_virtual)

    if destination_virtual == source_virtual:
        return {"from": source_virtual, "to": destination_virtual}
    if destination_abs.exists():
        raise MoveConflictError(f"Destination path '{destination_virtual}' already exists")
    if source_abs.is_dir() and _path_inside(destination_virtual, source_virtual):
        raise ValueError(f"Cannot rename folder '{source_virtual}' into itself or a descendant")

    moved = _execute_move_plan(
        project_id,
        [
            _MovePlanItem(
                source_virtual=source_virtual,
                source_abs=source_abs,
                destination_virtual=destination_virtual,
                destination_abs=destination_abs,
            )
        ],
    )
    if not moved:
        return {"from": source_virtual, "to": destination_virtual}
    return moved[0]


def delete_project_dir(project_id: str) -> None:
    root = project_dir(project_id)
    if root.exists():
        shutil.rmtree(root)


def ensure_default_agent_memory(project_id: str, content: str) -> None:
    root = ensure_project_dir(project_id)
    memory_path = root / "AGENT.md"
    if not memory_path.exists():
        memory_path.write_text(content)
