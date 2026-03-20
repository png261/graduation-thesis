from __future__ import annotations

from app.services.blueprints.types import ConfigurationAnsibleTemplate

CONFIGURATION_ANSIBLE_TEMPLATES: dict[str, ConfigurationAnsibleTemplate] = {
    "openclaw-install-configure": {
        "blueprint_id": "openclaw-install-configure",
        "playbook_path": "/playbooks/site.yml",
        "provenance_path": "/playbooks/PROVENANCE.md",
        "targets": [
            {
                "module_name": "compute",
                "title": "OpenClaw service host",
                "description": "Apply OpenClaw packages, service configuration, and validation on the generated compute host.",
                "step_ids": ["packages", "configure", "validate"],
            }
        ],
        "roles": [
            {
                "module_name": "compute",
                "defaults_from_inputs": {
                    "openclaw_version": "openclaw_version",
                    "openclaw_admin_cidr": "admin_cidr",
                    "openclaw_license_key": "license_key",
                },
                "task_titles": [
                    "Install OpenClaw prerequisites",
                    "Render OpenClaw environment",
                    "Validate OpenClaw runtime marker",
                ],
            }
        ],
    },
    "docker-compose-app-bootstrap": {
        "blueprint_id": "docker-compose-app-bootstrap",
        "playbook_path": "/playbooks/site.yml",
        "provenance_path": "/playbooks/PROVENANCE.md",
        "targets": [
            {
                "module_name": "compute",
                "title": "Docker application host",
                "description": "Install Docker, write Compose assets, and start the requested application stack on the generated compute host.",
                "step_ids": ["runtime", "compose", "validate"],
            }
        ],
        "roles": [
            {
                "module_name": "compute",
                "defaults_from_inputs": {
                    "compose_project_name": "compose_project_name",
                    "compose_published_port": "published_port",
                },
                "task_titles": [
                    "Install container runtime packages",
                    "Render Docker Compose application bundle",
                    "Start Docker Compose stack",
                ],
            }
        ],
    },
    "host-observability-baseline": {
        "blueprint_id": "host-observability-baseline",
        "playbook_path": "/playbooks/site.yml",
        "provenance_path": "/playbooks/PROVENANCE.md",
        "targets": [
            {
                "module_name": "compute",
                "title": "Observable host baseline",
                "description": "Install system observability agents, schedule inventory collection, and validate baseline telemetry on the generated compute host.",
                "step_ids": ["collector", "configure", "validate"],
            }
        ],
        "roles": [
            {
                "module_name": "compute",
                "defaults_from_inputs": {
                    "log_retention_days": "log_retention_days",
                    "inventory_schedule": "inventory_schedule",
                },
                "task_titles": [
                    "Install telemetry packages",
                    "Render telemetry configuration",
                    "Validate inventory collection marker",
                ],
            }
        ],
    },
}


def get_configuration_ansible_template(blueprint_id: str) -> ConfigurationAnsibleTemplate:
    try:
        return CONFIGURATION_ANSIBLE_TEMPLATES[blueprint_id]
    except KeyError as exc:
        raise ValueError("configuration_ansible_template_not_found") from exc
