"""Ansible runtime readiness/status helpers."""
from __future__ import annotations

from typing import Any

from app.core.config import Settings
from app.services.opentofu.runtime.shared import discover_modules_from_project_dir, load_project

from .runner import collect_hosts_for_modules
from .shared import ansible_available, resolve_playbook_path, resolve_project_root, resolve_ssh_key_path
from .summary import collect_config_visualization, read_latest_run_summary


def _discover_playbooks(project_id: str) -> list[str]:
    project_root = resolve_project_root(project_id)
    root = project_root / "playbooks"
    if not root.exists():
        return []
    playbooks: list[str] = []
    for suffix in ("*.yml", "*.yaml"):
        for path in root.rglob(suffix):
            if path.is_file():
                playbooks.append(path.relative_to(project_root).as_posix())
    playbooks.sort()
    return playbooks


async def get_ansible_status(project_id: str, settings: Settings) -> dict[str, Any]:
    project = await load_project(project_id)
    available = ansible_available()
    if project is None:
        return {
            "project_found": False,
            "ansible_available": available,
            "provider": None,
            "key_ready": False,
            "playbooks": [],
            "playbook_path": settings.ansible_playbook_path,
            "modules": [],
            "host_count": 0,
            "missing_requirements": ["project_not_found"],
            "output_errors": [],
            "config_summary": {
                "playbook_files": [],
                "role_task_files": [],
                "task_names": [],
                "package_targets": [],
                "service_targets": [],
                "file_targets": [],
                "module_usage_top": [],
            },
            "latest_run": None,
            "can_run": False,
        }

    project_root = resolve_project_root(project_id)
    key_path = resolve_ssh_key_path(settings)
    key_ready = bool(key_path and key_path.is_file())
    playbook_path = resolve_playbook_path(project_root, settings)
    playbook_ready = playbook_path.is_file()
    playbooks = _discover_playbooks(project_id)
    modules = discover_modules_from_project_dir(project_id)
    hosts, output_errors = await collect_hosts_for_modules(
        project_id=project_id,
        settings=settings,
        modules=modules,
        strict_state=False,
    )

    missing: list[str] = []
    if not available:
        missing.append("ansible_cli_unavailable")
    if not key_ready:
        missing.append("ssh_key_unavailable")
    if not playbook_ready:
        missing.append("playbook_missing")
    if not modules:
        missing.append("modules_missing")
    if not hosts:
        missing.append("ansible_hosts_missing")
    if output_errors:
        missing.append("invalid_ansible_hosts_output")

    config_summary = collect_config_visualization(project_root)
    latest_run = read_latest_run_summary(project_root)

    return {
        "project_found": True,
        "ansible_available": available,
        "provider": project.provider,
        "key_ready": key_ready,
        "playbooks": playbooks,
        "playbook_path": str(playbook_path),
        "modules": modules,
        "host_count": len(hosts),
        "missing_requirements": missing,
        "output_errors": output_errors,
        "config_summary": config_summary,
        "latest_run": latest_run,
        "can_run": len(missing) == 0,
    }
