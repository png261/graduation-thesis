"""Shared helpers for /api/projects route modules."""
from __future__ import annotations

import re

import yaml

from app.models import Project, Thread
from app.services.blueprints import service as blueprint_service
from app.services.project import credentials as project_credentials

_VALID_SKILL_NAME = re.compile(r"^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$")


def safe_skill_name(name: str) -> str:
    normalised = re.sub(r"[^a-z0-9-]", "-", name.lower().strip()).strip("-")
    normalised = re.sub(r"-{2,}", "-", normalised)
    if not normalised or not _VALID_SKILL_NAME.match(normalised):
        raise ValueError(f"Invalid skill name: '{name}'")
    return normalised


def parse_skill_frontmatter(content: str) -> str:
    """Return the description from YAML frontmatter, or empty string."""
    if content.startswith("---"):
        end = content.find("\n---", 3)
        if end != -1:
            try:
                fm = yaml.safe_load(content[3:end])
                if isinstance(fm, dict):
                    return str(fm.get("description", ""))
            except yaml.YAMLError:
                pass
    return ""


def mask_credentials(creds: dict) -> dict:
    """Return a copy of credentials with secret values masked."""
    return project_credentials.mask_credentials(creds)


def merge_credentials(existing: dict[str, str], patch: dict[str, str]) -> dict[str, str]:
    """Merge credential patch into existing values.

    Empty-string / null values remove keys; omitted keys are preserved.
    """
    return project_credentials.merge_credentials(existing, patch)


def blueprint_input_to_dict(definition: dict) -> dict:
    return {
        "key": definition["key"],
        "label": definition["label"],
        "description": definition.get("description", ""),
        "required": bool(definition.get("required", False)),
        "riskClass": definition.get("risk_class", "safe"),
        "defaultValue": definition.get("default_value"),
        "resolved": bool(definition.get("resolved", False)),
        "value": definition.get("value"),
    }


def blueprint_step_to_dict(step: dict) -> dict:
    return {
        "id": step["id"],
        "type": step["type"],
        "title": step["title"],
        "description": step["description"],
        "requiredInputs": list(step.get("required_inputs", [])),
        "expectedResult": step["expected_result"],
    }


def blueprint_selection_to_dict(selection: dict | None) -> dict | None:
    if selection is None:
        return None
    return {
        "kind": selection["kind"],
        "blueprintId": selection["blueprint_id"],
        "blueprintVersion": selection["blueprint_version"],
        "blueprintName": selection["blueprint_name"],
        "summary": selection["summary"],
        "resourcesOrActions": list(selection.get("resources_or_actions", [])),
        "requiredInputs": [
            blueprint_input_to_dict(item) for item in selection.get("required_inputs", [])
        ],
        "steps": [blueprint_step_to_dict(step) for step in selection.get("steps", [])],
        "inputs": dict(selection.get("inputs", {})),
        "selectedAt": selection.get("selected_at"),
        "latestRunId": selection.get("latest_run_id"),
        "latestRunCreatedAt": selection.get("latest_run_created_at"),
    }


def active_blueprints_to_dict(project: Project) -> dict:
    active = blueprint_service.get_active_blueprints(project)
    return {
        "provisioning": blueprint_selection_to_dict(active["provisioning"]),
        "configuration": blueprint_selection_to_dict(active["configuration"]),
    }


def project_to_dict(project: Project) -> dict:
    return {
        "id": project.id,
        "name": project.name,
        "provider": project.provider,
        "createdAt": project.created_at.isoformat(),
        "activeBlueprints": active_blueprints_to_dict(project),
    }


def thread_to_dict(thread: Thread) -> dict:
    return {"id": thread.id, "title": thread.title, "createdAt": thread.created_at.isoformat()}
