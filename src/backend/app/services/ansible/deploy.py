"""Ansible deploy/config service surface."""
from __future__ import annotations

from app.services.ansible.runtime.runner import (
    collect_post_deploy_result,
    collect_hosts_for_modules,
    run_playbook_collect,
    run_playbook_stream,
)
from app.services.ansible.runtime.status import get_ansible_status

__all__ = [
    "get_ansible_status",
    "collect_post_deploy_result",
    "collect_hosts_for_modules",
    "run_playbook_stream",
    "run_playbook_collect",
]
