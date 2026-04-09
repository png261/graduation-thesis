from __future__ import annotations

from .runtime import blueprint_service, conversation_persistence, identity_project_persistence, identity_project_service


def mask_credentials(creds: dict) -> dict:
    return identity_project_service.mask_credentials(creds)


def merge_credentials(existing: dict[str, str], patch: dict[str, str]) -> dict[str, str]:
    return identity_project_service.merge_credentials(existing, patch)


def _blueprint_input_to_dict(definition: dict) -> dict:
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


def _blueprint_step_to_dict(step: dict) -> dict:
    return {
        "id": step["id"],
        "type": step["type"],
        "title": step["title"],
        "description": step["description"],
        "requiredInputs": list(step.get("required_inputs", [])),
        "expectedResult": step["expected_result"],
    }


def _blueprint_selection_to_dict(selection: dict | None) -> dict | None:
    if selection is None:
        return None
    return {
        "kind": selection["kind"],
        "blueprintId": selection["blueprint_id"],
        "blueprintVersion": selection["blueprint_version"],
        "blueprintName": selection["blueprint_name"],
        "summary": selection["summary"],
        "resourcesOrActions": list(selection.get("resources_or_actions", [])),
        "requiredInputs": [_blueprint_input_to_dict(item) for item in selection.get("required_inputs", [])],
        "steps": [_blueprint_step_to_dict(step) for step in selection.get("steps", [])],
        "inputs": dict(selection.get("inputs", {})),
        "selectedAt": selection.get("selected_at"),
        "latestRunId": selection.get("latest_run_id"),
        "latestRunCreatedAt": selection.get("latest_run_created_at"),
    }


def _active_blueprints_to_dict(project: identity_project_persistence.Project) -> dict:
    active = blueprint_service.get_active_blueprints(project)
    return {
        "provisioning": _blueprint_selection_to_dict(active["provisioning"]),
        "configuration": _blueprint_selection_to_dict(active["configuration"]),
    }


def project_to_dict(project: identity_project_persistence.Project) -> dict:
    return {
        "id": project.id,
        "name": project.name,
        "provider": project.provider,
        "createdAt": project.created_at.isoformat(),
        "activeBlueprints": _active_blueprints_to_dict(project),
    }


def thread_to_dict(thread: conversation_persistence.Thread) -> dict:
    return {"id": thread.id, "title": thread.title, "createdAt": thread.created_at.isoformat()}
