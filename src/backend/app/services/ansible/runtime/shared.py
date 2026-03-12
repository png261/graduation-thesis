"""Shared helpers for Ansible runtime."""
from __future__ import annotations

import os
import shutil
from pathlib import Path

from app.core.config import Settings
from app.services.project import files as project_files


def ansible_available() -> bool:
    return shutil.which("ansible-playbook") is not None


def resolve_project_root(project_id: str) -> Path:
    return project_files.ensure_project_dir(project_id)


def resolve_playbook_path(project_root: Path, settings: Settings) -> Path:
    configured = (settings.ansible_playbook_path or "playbooks/site.yml").strip()
    path = Path(configured)
    if path.is_absolute():
        return path
    return project_root / path


def resolve_ssh_key_path(settings: Settings) -> Path | None:
    raw = (settings.ansible_ssh_key_path or "").strip()
    if not raw:
        return None
    return Path(raw).expanduser()


def ansible_run_env(settings: Settings) -> dict[str, str]:
    env = dict(os.environ)
    env["ANSIBLE_HOST_KEY_CHECKING"] = "True" if settings.ansible_host_key_checking else "False"
    return env
