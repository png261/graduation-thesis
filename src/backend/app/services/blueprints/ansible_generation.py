from __future__ import annotations

import hashlib
import json
import shutil
import tempfile
from textwrap import dedent
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app import db
from app.models import Project, ProjectAnsibleGeneration, ProjectBlueprintRun, ProjectTerraformGeneration
from app.services.agent.runtime.iac_templates import validate_iac_structure
from app.services.blueprints import service as blueprint_service
from app.services.blueprints.ansible_templates import get_configuration_ansible_template
from app.services.project import files as project_files

_PLAYBOOK_PATH = "/playbooks/site.yml"
_PROVENANCE_PATH = "/playbooks/PROVENANCE.md"


def _json_literal(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _digest(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _blueprint_inputs(run: ProjectBlueprintRun) -> dict[str, str]:
    return {str(key): str(value) for key, value in dict(run.inputs_json or {}).items()}


def _step_index(run: ProjectBlueprintRun) -> dict[str, dict[str, Any]]:
    snapshot = run.snapshot_json if isinstance(run.snapshot_json, dict) else {}
    return {
        str(step["id"]): step
        for step in snapshot.get("steps", [])
        if isinstance(step, dict) and step.get("id")
    }


def _step_titles(run: ProjectBlueprintRun, step_ids: list[str]) -> str:
    indexed = _step_index(run)
    titles = [str(indexed[step_id].get("title") or step_id) for step_id in step_ids if step_id in indexed]
    return ", ".join(titles) or "n/a"


def _header_comment(
    run: ProjectBlueprintRun,
    *,
    title: str,
    module_name: str | None = None,
    step_ids: list[str],
    inputs: dict[str, str],
) -> str:
    input_summary = ", ".join(f"{key}={value}" for key, value in sorted(inputs.items())) or "n/a"
    module_line = f"# Module: {module_name}" if module_name else None
    lines = [
        f"# Generated from configuration blueprint {run.blueprint_id} ({run.blueprint_version})",
        f"# Blueprint run: {run.id}",
        f"# Section: {title}",
        module_line,
        f"# Step titles: {_step_titles(run, step_ids)}",
        f"# Approved inputs: {input_summary}",
    ]
    return "\n".join(line for line in lines if line)


def _yaml_document(header: str, body: str) -> str:
    return f"{header}\n---\n{body.strip()}\n"


def _task_input_values(run: ProjectBlueprintRun, module_name: str) -> dict[str, str]:
    template = get_configuration_ansible_template(run.blueprint_id)
    for role in template["roles"]:
        if role["module_name"] != module_name:
            continue
        inputs = _blueprint_inputs(run)
        return {
            variable_name: str(inputs.get(input_key, ""))
            for variable_name, input_key in role["defaults_from_inputs"].items()
        }
    return {}


def _render_defaults_file(run: ProjectBlueprintRun, module_name: str, step_ids: list[str]) -> str:
    values = _task_input_values(run, module_name)
    body = "\n".join(f"{key}: {_json_literal(value)}" for key, value in values.items())
    if not body:
        body = "{}"
    return _yaml_document(
        _header_comment(
            run,
            title="role-defaults",
            module_name=module_name,
            step_ids=step_ids,
            inputs=_blueprint_inputs(run),
        ),
        body,
    )


def _openclaw_tasks(run: ProjectBlueprintRun, module_name: str, step_ids: list[str]) -> str:
    body = dedent(
        """
        - name: Install OpenClaw prerequisites
          ansible.builtin.package:
            name:
              - curl
              - tar
            state: present

        - name: Ensure OpenClaw configuration directory exists
          ansible.builtin.file:
            path: /etc/openclaw
            state: directory
            owner: root
            group: root
            mode: "0750"

        - name: Render OpenClaw environment
          ansible.builtin.copy:
            dest: /etc/openclaw/openclaw.env
            owner: root
            group: root
            mode: "0600"
            content: |
              OPENCLAW_VERSION={{ openclaw_version }}
              OPENCLAW_ADMIN_CIDR={{ openclaw_admin_cidr }}
              OPENCLAW_LICENSE_KEY={{ openclaw_license_key }}

        - name: Write OpenClaw readiness marker
          ansible.builtin.copy:
            dest: /var/lib/openclaw/ready
            owner: root
            group: root
            mode: "0644"
            content: "openclaw configured\n"

        - name: Validate OpenClaw runtime marker
          ansible.builtin.command: /bin/sh -lc "test -f /var/lib/openclaw/ready"
          changed_when: false
        """
    )
    return _yaml_document(
        _header_comment(
            run,
            title="role-tasks",
            module_name=module_name,
            step_ids=step_ids,
            inputs=_blueprint_inputs(run),
        ),
        body,
    )


def _docker_compose_tasks(run: ProjectBlueprintRun, module_name: str, step_ids: list[str]) -> str:
    body = dedent(
        """
        - name: Install container runtime packages
          ansible.builtin.package:
            name:
              - docker
              - docker-compose-plugin
            state: present

        - name: Ensure Docker Compose app directory exists
          ansible.builtin.file:
            path: /opt/{{ compose_project_name }}
            state: directory
            owner: root
            group: root
            mode: "0755"

        - name: Render Docker Compose application bundle
          ansible.builtin.copy:
            dest: /opt/{{ compose_project_name }}/compose.yaml
            owner: root
            group: root
            mode: "0644"
            content: |
              services:
                app:
                  image: nginx:stable
                  ports:
                    - "{{ compose_published_port }}:80"

        - name: Start Docker Compose stack
          ansible.builtin.command:
            cmd: docker compose -f /opt/{{ compose_project_name }}/compose.yaml up -d
          changed_when: true

        - name: Validate Docker Compose manifest exists
          ansible.builtin.command: /bin/sh -lc "test -f /opt/{{ compose_project_name }}/compose.yaml"
          changed_when: false
        """
    )
    return _yaml_document(
        _header_comment(
            run,
            title="role-tasks",
            module_name=module_name,
            step_ids=step_ids,
            inputs=_blueprint_inputs(run),
        ),
        body,
    )


def _observability_tasks(run: ProjectBlueprintRun, module_name: str, step_ids: list[str]) -> str:
    body = dedent(
        """
        - name: Install telemetry packages
          ansible.builtin.package:
            name:
              - amazon-cloudwatch-agent
              - cronie
            state: present

        - name: Ensure observability directory exists
          ansible.builtin.file:
            path: /etc/infra-observability
            state: directory
            owner: root
            group: root
            mode: "0755"

        - name: Render telemetry configuration
          ansible.builtin.copy:
            dest: /etc/infra-observability/baseline.env
            owner: root
            group: root
            mode: "0644"
            content: |
              LOG_RETENTION_DAYS={{ log_retention_days }}
              INVENTORY_SCHEDULE={{ inventory_schedule }}

        - name: Render inventory collection cron
          ansible.builtin.copy:
            dest: /etc/cron.d/infra-inventory
            owner: root
            group: root
            mode: "0644"
            content: |
              {{ inventory_schedule }} root /usr/bin/env echo inventory-ready >/var/log/infra-inventory.log

        - name: Validate telemetry baseline marker
          ansible.builtin.command: /bin/sh -lc "test -f /etc/infra-observability/baseline.env"
          changed_when: false
        """
    )
    return _yaml_document(
        _header_comment(
            run,
            title="role-tasks",
            module_name=module_name,
            step_ids=step_ids,
            inputs=_blueprint_inputs(run),
        ),
        body,
    )


def _render_role_tasks(run: ProjectBlueprintRun, module_name: str, step_ids: list[str]) -> str:
    if run.blueprint_id == "openclaw-install-configure":
        return _openclaw_tasks(run, module_name, step_ids)
    if run.blueprint_id == "docker-compose-app-bootstrap":
        return _docker_compose_tasks(run, module_name, step_ids)
    if run.blueprint_id == "host-observability-baseline":
        return _observability_tasks(run, module_name, step_ids)
    raise ValueError("configuration_ansible_template_not_found")


def _playbook_content(run: ProjectBlueprintRun, target_modules: list[str]) -> str:
    roles_block = "  roles: []"
    if target_modules:
        role_lines = "\n".join(f"    - role: {module_name}" for module_name in target_modules)
        roles_block = f"  roles:\n{role_lines}"
    body = "\n".join(
        (
            f"- name: {run.blueprint_name}",
            "  hosts: all",
            "  become: true",
            "  gather_facts: true",
            roles_block,
        )
    )
    return _yaml_document(
        _header_comment(
            run,
            title="playbook",
            step_ids=[step["id"] for step in _step_index(run).values()],
            inputs=_blueprint_inputs(run),
        ),
        body,
    )


def _provenance_content(
    run: ProjectBlueprintRun,
    latest_terraform_generation: ProjectTerraformGeneration,
    target_modules: list[str],
    skipped_modules: list[str],
) -> str:
    lines = [
        f"# Configuration Provenance for {run.blueprint_name}",
        "",
        f"- Blueprint id: `{run.blueprint_id}`",
        f"- Blueprint version: `{run.blueprint_version}`",
        f"- Blueprint run id: `{run.id}`",
        f"- Terraform generation id: `{latest_terraform_generation.id}`",
        f"- Playbook: `{_PLAYBOOK_PATH}`",
        f"- Target modules: {', '.join(f'`{item}`' for item in target_modules) if target_modules else 'none'}",
        f"- Skipped modules: {', '.join(f'`{item}`' for item in skipped_modules) if skipped_modules else 'none'}",
        "",
        "## Inputs",
    ]
    inputs = _blueprint_inputs(run)
    if not inputs:
        lines.append("- none")
    else:
        for key, value in sorted(inputs.items()):
            lines.append(f"- `{key}` = `{value}`")
    return "\n".join(lines).strip() + "\n"


def _render_generation_files(
    run: ProjectBlueprintRun,
    latest_terraform_generation: ProjectTerraformGeneration,
    target_modules: list[str],
    skipped_modules: list[str],
) -> dict[str, str]:
    template = get_configuration_ansible_template(run.blueprint_id)
    targets_by_module = {item["module_name"]: item for item in template["targets"]}
    files: dict[str, str] = {
        template["playbook_path"]: _playbook_content(run, target_modules),
        template["provenance_path"]: _provenance_content(
            run,
            latest_terraform_generation,
            target_modules,
            skipped_modules,
        ),
    }
    for module_name in target_modules:
        target = targets_by_module[module_name]
        files[f"/roles/{module_name}/tasks/main.yml"] = _render_role_tasks(
            run,
            module_name,
            target["step_ids"],
        )
        files[f"/roles/{module_name}/defaults/main.yml"] = _render_defaults_file(
            run,
            module_name,
            target["step_ids"],
        )
    return files


def _existing_generated_paths(generation: ProjectAnsibleGeneration | None) -> dict[str, str]:
    if generation is None:
        return {}
    payload = generation.generated_paths_json if isinstance(generation.generated_paths_json, dict) else {}
    return {str(path): str(digest) for path, digest in payload.items()}


def _compare_targets(
    current: list[str],
    previous: ProjectAnsibleGeneration | None,
) -> list[str]:
    if previous is None:
        return []
    prior = set(previous.target_modules_json or [])
    return sorted(prior - set(current))


def _resolved_required_inputs(selection: dict[str, Any] | None) -> bool:
    if selection is None:
        return False
    for item in selection.get("required_inputs", []):
        if item.get("required") and not item.get("resolved"):
            return False
    return True


def _project_root(project_id: str):
    return project_files.ensure_project_dir(project_id)


def _validation_payload(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": raw["status"],
        "checkedModules": raw["checked_modules"],
        "missing": raw["missing"],
        "violations": raw["violations"],
        "requireAnsible": raw["require_ansible"],
    }


def _empty_validation(message: str) -> dict[str, Any]:
    return {
        "status": "fail",
        "checkedModules": [],
        "missing": [],
        "violations": [message],
        "requireAnsible": True,
    }


def _validate_generation_preview(
    project_id: str,
    rendered: dict[str, str],
    *,
    target_modules: list[str],
    latest_generation: ProjectAnsibleGeneration | None,
) -> dict[str, Any]:
    if not target_modules:
        return _empty_validation("No generated configuration roles match the latest Terraform modules.")

    project_root = _project_root(project_id)
    with tempfile.TemporaryDirectory(prefix="ansible-preview-") as temp_dir:
        temp_root = shutil.copytree(project_root, f"{temp_dir}/workspace", dirs_exist_ok=True)
        temp_root_path = temp_root if isinstance(temp_root, str) else str(temp_root)
        workspace = project_root.__class__(temp_root_path)
        for path in set(_existing_generated_paths(latest_generation)) - set(rendered):
            candidate = workspace / path.lstrip("/")
            if candidate.exists():
                candidate.unlink()
        for path, content in rendered.items():
            candidate = workspace / path.lstrip("/")
            candidate.parent.mkdir(parents=True, exist_ok=True)
            candidate.write_text(content, encoding="utf-8")
        raw = validate_iac_structure(workspace, selected_modules=target_modules, require_ansible=True)
    return _validation_payload(raw)


def _generation_summary(
    run: ProjectBlueprintRun,
    generated_files: list[str],
    *,
    latest_generation: ProjectAnsibleGeneration | None,
    latest_terraform_generation: ProjectTerraformGeneration,
    target_modules: list[str],
    skipped_modules: list[str],
) -> dict[str, Any]:
    return {
        "headline": f"{run.blueprint_name} -> {_PLAYBOOK_PATH}",
        "blueprintId": run.blueprint_id,
        "blueprintName": run.blueprint_name,
        "blueprintRunId": run.id,
        "inputs": _blueprint_inputs(run),
        "playbookPath": _PLAYBOOK_PATH,
        "fileCount": len(generated_files),
        "roleCount": len(target_modules),
        "terraformGenerationId": latest_terraform_generation.id,
        "latestGenerationId": latest_generation.id if latest_generation else None,
        "targetModules": list(target_modules),
        "skippedModules": list(skipped_modules),
    }


def generation_record_to_dict(
    record: ProjectAnsibleGeneration | None,
    *,
    compare_to_previous: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    if record is None:
        return None
    return {
        "id": record.id,
        "projectId": record.project_id,
        "blueprintRunId": record.blueprint_run_id,
        "playbookPath": record.playbook_path,
        "targetModules": list(record.target_modules_json or []),
        "skippedModules": list(record.skipped_modules_json or []),
        "generatedPaths": dict(record.generated_paths_json or {}),
        "summary": dict(record.summary_json or {}),
        "provenanceReportPath": record.provenance_report_path,
        "replacesGenerationId": record.replaces_generation_id,
        "createdAt": record.created_at.isoformat() if record.created_at else None,
        "compare": compare_to_previous,
    }


def build_configuration_generation_preview(
    project: Project,
    selection: dict[str, Any],
    run_snapshot: ProjectBlueprintRun,
    latest_terraform_generation: ProjectTerraformGeneration,
) -> dict[str, Any]:
    if not _resolved_required_inputs(selection):
        raise ValueError("unresolved_blueprint_inputs")
    template = get_configuration_ansible_template(run_snapshot.blueprint_id)
    latest_generation = getattr(project, "_latest_ansible_generation", None)
    latest_modules = sorted(str(item) for item in list(latest_terraform_generation.module_names_json or []))
    target_candidates = [item["module_name"] for item in template["targets"]]
    target_modules = [module_name for module_name in latest_modules if module_name in target_candidates]
    skipped_modules = [module_name for module_name in latest_modules if module_name not in target_modules]
    rendered = _render_generation_files(
        run_snapshot,
        latest_terraform_generation,
        target_modules,
        skipped_modules,
    )
    generated_files = sorted(rendered)
    validation = _validate_generation_preview(
        project.id,
        rendered,
        target_modules=target_modules,
        latest_generation=latest_generation,
    )
    removed_roles = _compare_targets(target_modules, latest_generation)
    inputs_changed = False
    if latest_generation is not None:
        previous_inputs = dict((latest_generation.summary_json or {}).get("inputs", {}))
        inputs_changed = previous_inputs != _blueprint_inputs(run_snapshot)
    summary = _generation_summary(
        run_snapshot,
        generated_files,
        latest_generation=latest_generation,
        latest_terraform_generation=latest_terraform_generation,
        target_modules=target_modules,
        skipped_modules=skipped_modules,
    )
    payload = {
        "status": "ok",
        "blueprintRunId": run_snapshot.id,
        "playbookPath": template["playbook_path"],
        "targetModules": target_modules,
        "skippedModules": skipped_modules,
        "generatedFiles": generated_files,
        "validation": validation,
        "mode": "regenerate" if latest_generation else "generate",
        "inputsChanged": inputs_changed,
        "removedRoles": removed_roles,
        "summary": summary,
        "validationIssues": [*validation["missing"], *validation["violations"]],
        "latestGeneration": generation_record_to_dict(latest_generation),
    }
    token_payload = {
        "blueprintRunId": payload["blueprintRunId"],
        "targetModules": payload["targetModules"],
        "skippedModules": payload["skippedModules"],
        "generatedFiles": payload["generatedFiles"],
        "removedRoles": payload["removedRoles"],
        "inputs": summary["inputs"],
        "latestGenerationId": (payload["latestGeneration"] or {}).get("id"),
        "terraformGenerationId": latest_terraform_generation.id,
        "mode": payload["mode"],
    }
    payload["previewToken"] = blueprint_service.preview_token_from_payload(token_payload)
    return payload


def _write_generation_files(project_id: str, files: dict[str, str]) -> list[str]:
    written: list[str] = []
    for path, content in sorted(files.items()):
        project_files.write_text(project_id, path, content)
        written.append(path)
    return written


def _remove_stale_files(
    project_id: str,
    previous: ProjectAnsibleGeneration | None,
    next_paths: dict[str, str],
) -> list[str]:
    if previous is None:
        return []
    removed: list[str] = []
    for path in sorted(set(_existing_generated_paths(previous)) - set(next_paths)):
        try:
            project_files.delete_file(project_id, path)
        except FileNotFoundError:
            continue
        removed.append(path)
    return removed


async def _load_generation_context(
    session: AsyncSession,
    project_id: str,
) -> tuple[
    Project,
    dict[str, Any],
    ProjectBlueprintRun,
    ProjectTerraformGeneration,
    ProjectAnsibleGeneration | None,
]:
    project = await session.get(Project, project_id)
    if project is None:
        raise ValueError("project_not_found")
    selection = blueprint_service.get_active_blueprint_selection(project, "configuration")
    if selection is None:
        raise ValueError("no_active_configuration_blueprint")
    run_snapshot = await blueprint_service.get_latest_blueprint_run(session, project, "configuration")
    if run_snapshot is None:
        raise ValueError("missing_configuration_blueprint_run_snapshot")
    latest_terraform_generation = await blueprint_service.get_latest_terraform_generation(session, project_id)
    if latest_terraform_generation is None:
        raise ValueError("missing_terraform_generation")
    latest_ansible_generation = await blueprint_service.get_latest_ansible_generation(session, project_id)
    setattr(project, "_latest_ansible_generation", latest_ansible_generation)
    return (
        project,
        selection,
        run_snapshot,
        latest_terraform_generation,
        latest_ansible_generation,
    )


async def generate_configuration_ansible(
    project_id: str,
    *,
    session: AsyncSession | None = None,
    preview_token: str | None = None,
    confirm_write: bool = False,
) -> dict[str, Any]:
    async def _run(active_session: AsyncSession) -> dict[str, Any]:
        (
            project,
            selection,
            run_snapshot,
            latest_terraform_generation,
            latest_generation,
        ) = await _load_generation_context(active_session, project_id)
        preview = build_configuration_generation_preview(
            project,
            selection,
            run_snapshot,
            latest_terraform_generation,
        )
        if not confirm_write:
            raise ValueError("ansible_generation_confirmation_required")
        if not preview_token or preview_token != preview["previewToken"]:
            raise ValueError("ansible_preview_stale")
        if preview["validationIssues"]:
            raise ValueError("ansible_generation_validation_failed")
        rendered = _render_generation_files(
            run_snapshot,
            latest_terraform_generation,
            preview["targetModules"],
            preview["skippedModules"],
        )
        next_paths = {path: _digest(content) for path, content in rendered.items()}
        removed_files = _remove_stale_files(project_id, latest_generation, next_paths)
        written_files = _write_generation_files(project_id, rendered)
        validation = validate_iac_structure(
            _project_root(project_id),
            selected_modules=preview["targetModules"],
            require_ansible=True,
        )
        if validation["status"] != "pass":
            raise ValueError("ansible_generation_validation_failed")
        summary = {
            **preview["summary"],
            "mode": preview["mode"],
            "removedRoles": preview["removedRoles"],
            "removedFiles": removed_files,
            "inputsChanged": preview["inputsChanged"],
        }
        record = await blueprint_service.create_ansible_generation_record(
            active_session,
            project_id=project_id,
            blueprint_run_id=run_snapshot.id,
            playbook_path=preview["playbookPath"],
            target_modules=preview["targetModules"],
            skipped_modules=preview["skippedModules"],
            generated_paths=next_paths,
            summary=summary,
            provenance_report_path=_PROVENANCE_PATH,
            replaces_generation_id=latest_generation.id if latest_generation else None,
        )
        return {
            **preview,
            "validation": _validation_payload(validation),
            "validationIssues": [*validation["missing"], *validation["violations"]],
            "writtenFiles": written_files,
            "removedFiles": removed_files,
            "provenanceReportPath": _PROVENANCE_PATH,
            "generation": generation_record_to_dict(
                record,
                compare_to_previous=blueprint_service.compare_ansible_generations(record, latest_generation),
            ),
            "latestGeneration": generation_record_to_dict(record),
        }

    if session is not None:
        return await _run(session)
    async with db.get_session() as managed:
        return await _run(managed)


async def preview_configuration_ansible(
    session: AsyncSession,
    project_id: str,
) -> dict[str, Any]:
    project, selection, run_snapshot, latest_terraform_generation, _ = await _load_generation_context(
        session,
        project_id,
    )
    return build_configuration_generation_preview(
        project,
        selection,
        run_snapshot,
        latest_terraform_generation,
    )


async def list_configuration_ansible_history(
    session: AsyncSession,
    project_id: str,
    *,
    limit: int = 20,
) -> list[dict[str, Any]]:
    records = await blueprint_service.list_ansible_generations(session, project_id, limit=limit)
    items: list[dict[str, Any]] = []
    for index, record in enumerate(records):
        previous = records[index + 1] if index + 1 < len(records) else None
        compare = blueprint_service.compare_ansible_generations(record, previous)
        items.append(generation_record_to_dict(record, compare_to_previous=compare) or {})
    return items


async def get_configuration_ansible_history_item(
    session: AsyncSession,
    project_id: str,
    generation_id: str,
) -> dict[str, Any] | None:
    record = await blueprint_service.get_ansible_generation(session, project_id, generation_id)
    if record is None:
        return None
    records = await blueprint_service.list_ansible_generations(session, project_id, limit=100)
    previous = None
    for index, item in enumerate(records):
        if item.id != generation_id:
            continue
        previous = records[index + 1] if index + 1 < len(records) else None
        break
    compare = blueprint_service.compare_ansible_generations(record, previous)
    return generation_record_to_dict(record, compare_to_previous=compare)
