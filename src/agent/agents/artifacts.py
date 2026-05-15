"""Session artifact paths that are intentionally outside repository checkouts."""

from __future__ import annotations

import os
import re
from pathlib import Path


def safe_session_id(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "-", value or "agentcore")


def safe_artifact_category(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip()).strip(".-") or "artifacts"


def shared_artifact_base_path() -> Path:
    return Path(
        os.environ.get("SHARED_FILES_ACTIVE_PATH")
        or os.environ.get("SHARED_FILES_MOUNT_PATH", "/mnt/s3")
    )


def session_artifact_dir(session_id: str, category: str, base_path: Path | None = None) -> Path:
    root = base_path or shared_artifact_base_path()
    path = root / "sessions" / safe_session_id(session_id) / safe_artifact_category(category)
    path.mkdir(parents=True, exist_ok=True)
    return path
