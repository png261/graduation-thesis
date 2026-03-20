"""Helpers for same-session plan review metadata and workspace freshness."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
from pathlib import Path
from typing import Any, Iterable

from app.services.project import files as project_files

REVIEW_SESSION_MAX_AGE_MINUTES = 30
WORKSPACE_FINGERPRINT_EXCLUDES = {".git", ".opentofu-runtime", ".agents", ".claude", "AGENTS.md"}


def _is_excluded_path(relative_path: Path) -> bool:
    parts = relative_path.parts
    return bool(parts) and parts[0] in WORKSPACE_FINGERPRINT_EXCLUDES


def _iter_fingerprint_files(project_root: Path) -> Iterable[tuple[str, bytes]]:
    if not project_root.exists():
        return []
    rows: list[tuple[str, bytes]] = []
    for candidate in sorted(project_root.rglob("*")):
        if not candidate.is_file():
            continue
        relative_path = candidate.relative_to(project_root)
        if _is_excluded_path(relative_path):
            continue
        rows.append((relative_path.as_posix(), candidate.read_bytes()))
    return rows


def build_workspace_fingerprint(project_id: str) -> str:
    project_root = project_files.ensure_project_dir(project_id)
    digest = hashlib.sha256()
    for relative_path, content in _iter_fingerprint_files(project_root):
        digest.update(relative_path.encode("utf-8"))
        digest.update(b"\0")
        digest.update(hashlib.sha256(content).digest())
        digest.update(b"\0")
    return digest.hexdigest()


def _normalize_review_target(value: str | None) -> str:
    return value or "apply"


def _normalize_scope_mode(value: str | None, selected_modules: list[str] | None) -> str:
    if value:
        return value
    return "partial" if selected_modules else "full"


def _normalize_modules(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if isinstance(item, str)]


def record_plan_review_metadata(
    *,
    project_id: str,
    result: dict[str, Any],
    review_session_id: str | None = None,
    review_target: str | None = None,
    scope_mode: str | None = None,
    selected_modules: list[str] | None = None,
    reviewed_at: datetime | None = None,
) -> dict[str, Any]:
    timestamp = reviewed_at or datetime.now(timezone.utc)
    normalized_modules = _normalize_modules(selected_modules)
    return {
        **result,
        "review_session_id": review_session_id or "",
        "review_target": _normalize_review_target(review_target),
        "scope_mode": _normalize_scope_mode(scope_mode, normalized_modules),
        "selected_modules": normalized_modules,
        "workspace_fingerprint": build_workspace_fingerprint(project_id),
        "reviewed_at": timestamp.isoformat(),
    }


def _parse_reviewed_at(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _with_review_status(review_result: dict[str, Any], status: str) -> dict[str, Any]:
    return {**review_result, "status": status}


def resolve_plan_review(
    *,
    project_id: str,
    review_result: dict[str, Any] | None,
    review_session_id: str | None = None,
    review_target: str = "apply",
    scope_mode: str = "full",
    selected_modules: list[str] | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    current_time = now or datetime.now(timezone.utc)
    normalized_modules = _normalize_modules(selected_modules)
    if not isinstance(review_result, dict):
        return {"status": "missing"}

    reviewed_at = _parse_reviewed_at(review_result.get("reviewed_at"))
    if reviewed_at is None:
        return _with_review_status(review_result, "stale")

    if current_time - reviewed_at > timedelta(minutes=REVIEW_SESSION_MAX_AGE_MINUTES):
        return _with_review_status(review_result, "stale")

    actual_session_id = str(review_result.get("review_session_id") or "")
    if review_session_id and actual_session_id != review_session_id:
        return _with_review_status(review_result, "session_mismatch")

    actual_target = _normalize_review_target(review_result.get("review_target"))
    actual_scope_mode = _normalize_scope_mode(
        str(review_result.get("scope_mode") or ""),
        _normalize_modules(review_result.get("selected_modules")),
    )
    actual_modules = _normalize_modules(review_result.get("selected_modules"))
    if (
        actual_target != _normalize_review_target(review_target)
        or actual_scope_mode != _normalize_scope_mode(scope_mode, normalized_modules)
        or actual_modules != normalized_modules
    ):
        return _with_review_status(review_result, "scope_mismatch")

    current_fingerprint = build_workspace_fingerprint(project_id)
    actual_fingerprint = str(review_result.get("workspace_fingerprint") or "")
    if actual_fingerprint != current_fingerprint:
        return _with_review_status(review_result, "workspace_changed")

    return _with_review_status(review_result, "fresh")
