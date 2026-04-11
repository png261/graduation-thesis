"""Code-backed Terraform and Ansible template contracts."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

TERRAFORM_REQUIRED_FILES: tuple[str, ...] = (
    "versions.tf",
    "providers.tf",
    "main.tf",
    "variables.tf",
    "outputs.tf",
    "README.md",
    "examples/basic/main.tf",
)
TERRAFORM_OPTIONAL_FILES: tuple[str, ...] = ("locals.tf",)
ANSIBLE_PLAYBOOK_PATH = "playbooks/site.yml"
ANSIBLE_ROLE_REQUIRED_FILES: tuple[str, ...] = (
    "roles/{module}/tasks/main.yml",
    "roles/{module}/defaults/main.yml",
)
ANSIBLE_HOSTS_OUTPUT_NAME = "ansible_hosts"
CONFIGURATION_TARGETS_OUTPUT_NAME = "configuration_targets"
CANONICAL_TARGET_CONTRACT_OUTPUT_NAME = "configuration_target_contract"
TARGET_CONTRACT_SCHEMA_VERSION = 1
TARGET_CONTRACT_DEDUPE_KEY = "execution_id"
TARGET_CONTRACT_REQUIRED_FIELDS: tuple[str, ...] = (
    "execution_id",
    "role",
    "source_modules",
)
TARGET_CONTRACT_OPTIONAL_FIELDS: tuple[str, ...] = (
    "display_name",
    "platform",
    "private_ip",
    "public_ip",
    "hostname",
    "labels",
    "tags",
)
_ANSIBLE_OUTPUT_ANCHOR_RE = re.compile(r'output\s+"ansible_hosts"\s*{', flags=re.IGNORECASE)
_CONFIGURATION_TARGETS_OUTPUT_ANCHOR_RE = re.compile(
    r'output\s+"configuration_targets"\s*{',
    flags=re.IGNORECASE,
)
_CANONICAL_TARGET_OUTPUT_ANCHOR_RE = re.compile(
    r'output\s+"configuration_target_contract"\s*{',
    flags=re.IGNORECASE,
)
_SAFE_MODULE_RE = re.compile(r"^[A-Za-z0-9_.-]+$")
_ROLE_ITEM_RE = re.compile(r"^\s*-\s*role:\s*([A-Za-z0-9_.-]+)\s*$")
_ROLE_SHORT_RE = re.compile(r"^\s*-\s*([A-Za-z0-9_.-]+)\s*$")
_ROLES_HEADER_RE = re.compile(r"^\s*roles:\s*$", re.MULTILINE)
_HOSTS_HEADER_RE = re.compile(r"^\s*-?\s*hosts\s*:\s*\S+", re.MULTILINE)
_TASK_NAME_RE = re.compile(r"^\s*-\s+name:\s+\S+", re.MULTILINE)
_MODULE_EXAMPLE_SOURCE_RE = re.compile(r'^\s*source\s*=\s*["\']\.\./\.\./["\']\s*$', re.MULTILINE)


def provider_credential_vars(provider: str | None) -> tuple[str, ...]:
    if provider == "aws":
        return ("aws_access_key_id", "aws_secret_access_key", "aws_region")
    if provider == "gcloud":
        return ("gcp_project_id", "gcp_region", "gcp_credentials_json")
    return ()


def build_template_contract_markdown() -> str:
    terraform_files = ", ".join(f"`{name}`" for name in TERRAFORM_REQUIRED_FILES)
    ansible_files = ", ".join(f"`{item.replace('{module}', '<module>')}`" for item in ANSIBLE_ROLE_REQUIRED_FILES)
    return "\n".join(
        (
            "## Template Contract",
            f"- Terraform module required files: {terraform_files}",
            f"- Optional Terraform files: `{TERRAFORM_OPTIONAL_FILES[0]}`",
            f"- Every module must declare output `{ANSIBLE_HOSTS_OUTPUT_NAME}` (use `[]` when no hosts).",
            f"- Every module must declare output `{CONFIGURATION_TARGETS_OUTPUT_NAME}` (use `[]` when no runtime targets exist).",
            f"- The stack must declare output `{CANONICAL_TARGET_CONTRACT_OUTPUT_NAME}`.",
            f"- Ansible entrypoint required only when configuration targets exist: `{ANSIBLE_PLAYBOOK_PATH}`.",
            f"- Ansible role required files per configured module: {ansible_files}",
            '- Every `examples/basic/main.tf` must reference the module with `source = "../../"`.',
            "- Module-to-role mapping is 1:1 only for modules that require configuration (`modules/<module>` -> `roles/<module>`).",
            f"- Output `{ANSIBLE_HOSTS_OUTPUT_NAME}` must expose at least `name` and `address` fields.",
            (
                f"- Output `{CONFIGURATION_TARGETS_OUTPUT_NAME}` must expose "
                "`execution_id`, `role`, and `source_modules`."
            ),
            "- Output blocks for host and target contracts must define a `value = ...` assignment.",
            "- `playbooks/site.yml` must declare at least one `hosts:` entry when Ansible is required.",
            "- Each `roles/<module>/tasks/main.yml` must contain at least one named task item.",
            "- If no modules require configuration, skip playbooks/roles and validate with `require_ansible=false`.",
            "- `validate_iac_structure()` automatically enforces target-contract outputs when `require_ansible=true`.",
        )
    )


def _module_names_from_project(project_root: Path) -> list[str]:
    modules_root = project_root / "modules"
    if not modules_root.is_dir():
        return []
    names: list[str] = []
    for candidate in sorted(modules_root.iterdir()):
        if not candidate.is_dir():
            continue
        if any(candidate.glob("*.tf")):
            names.append(candidate.name)
    return names


def _module_targets(project_root: Path, selected_modules: list[str] | None) -> tuple[list[str], list[str]]:
    discovered = _module_names_from_project(project_root)
    if not selected_modules:
        return discovered, []
    requested = []
    unknown = []
    for module in selected_modules:
        if module in discovered:
            requested.append(module)
        else:
            unknown.append(module)
    return requested, unknown


def _missing_module_files(project_root: Path, module: str) -> list[str]:
    module_root = project_root / "modules" / module
    missing: list[str] = []
    for relative in TERRAFORM_REQUIRED_FILES:
        if not (module_root / relative).is_file():
            missing.append(f"modules/{module}/{relative}")
    return missing


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


def _missing_output_contract(project_root: Path, module: str) -> str | None:
    outputs_path = project_root / "modules" / module / "outputs.tf"
    content = _read_text(outputs_path)
    if not content:
        return f"modules/{module}/outputs.tf missing readable content"
    if _output_has_value(content, ANSIBLE_HOSTS_OUTPUT_NAME):
        return None
    if _ANSIBLE_OUTPUT_ANCHOR_RE.search(content):
        return f'modules/{module}/outputs.tf output "{ANSIBLE_HOSTS_OUTPUT_NAME}" missing value assignment'
    return f'modules/{module}/outputs.tf missing output "{ANSIBLE_HOSTS_OUTPUT_NAME}"'


def _missing_target_contract_output(project_root: Path, module: str) -> str | None:
    outputs_path = project_root / "modules" / module / "outputs.tf"
    content = _read_text(outputs_path)
    if not content:
        return f"modules/{module}/outputs.tf missing readable content"
    if _output_has_value(content, CONFIGURATION_TARGETS_OUTPUT_NAME):
        return None
    if _CONFIGURATION_TARGETS_OUTPUT_ANCHOR_RE.search(content):
        return f'modules/{module}/outputs.tf output "{CONFIGURATION_TARGETS_OUTPUT_NAME}" missing value assignment'
    return f'modules/{module}/outputs.tf missing output "{CONFIGURATION_TARGETS_OUTPUT_NAME}"'


def _missing_canonical_target_contract(project_root: Path) -> str | None:
    outputs_path = project_root / "stacks" / "main" / "outputs.tf"
    content = _read_text(outputs_path)
    if not content:
        return "stacks/main/outputs.tf missing readable content"
    if _output_has_value(content, CANONICAL_TARGET_CONTRACT_OUTPUT_NAME):
        return None
    if _CANONICAL_TARGET_OUTPUT_ANCHOR_RE.search(content):
        return f'stacks/main/outputs.tf output "{CANONICAL_TARGET_CONTRACT_OUTPUT_NAME}" missing value assignment'
    return f'stacks/main/outputs.tf missing output "{CANONICAL_TARGET_CONTRACT_OUTPUT_NAME}"'


def _expected_role_paths(module: str) -> list[str]:
    return [item.format(module=module) for item in ANSIBLE_ROLE_REQUIRED_FILES]


def _missing_role_files(project_root: Path, module: str) -> list[str]:
    missing: list[str] = []
    for relative in _expected_role_paths(module):
        if not (project_root / relative).is_file():
            missing.append(relative)
    return missing


def _example_contract_issue(project_root: Path, module: str) -> str | None:
    content = _read_text(project_root / "modules" / module / "examples" / "basic" / "main.tf")
    if not content:
        return f"modules/{module}/examples/basic/main.tf missing readable content"
    if _MODULE_EXAMPLE_SOURCE_RE.search(content):
        return None
    return f'modules/{module}/examples/basic/main.tf must reference the module with source = "../../"'


def _output_has_value(content: str, output_name: str) -> bool:
    anchor = f'output "{output_name}"'
    start = content.find(anchor)
    if start < 0:
        return False
    brace_start = content.find("{", start)
    if brace_start < 0:
        return False
    depth = 0
    for raw in content[brace_start:].splitlines():
        depth += raw.count("{")
        if depth > 0 and re.match(r"^\s*value\s*=", raw):
            return True
        depth -= raw.count("}")
        if depth <= 0:
            return False
    return False


def _extract_output_block(content: str, output_name: str) -> str | None:
    anchor = f'output "{output_name}"'
    start = content.find(anchor)
    if start < 0:
        return None
    brace_start = content.find("{", start)
    if brace_start < 0:
        return content[start:]
    depth = 0
    for index in range(brace_start, len(content)):
        if content[index] == "{":
            depth += 1
        elif content[index] == "}":
            depth -= 1
            if depth == 0:
                return content[start : index + 1]
    return content[start:]


def _missing_output_fields(content: str, output_name: str, fields: tuple[str, ...]) -> list[str]:
    block = _extract_output_block(content, output_name)
    if block is None:
        return []
    missing: list[str] = []
    for field in fields:
        if not re.search(rf"\b{re.escape(field)}\s*=", block):
            missing.append(field)
    return missing


def _output_field_violations(project_root: Path, module: str, *, require_target_contract: bool) -> list[str]:
    content = _read_text(project_root / "modules" / module / "outputs.tf")
    if not content:
        return []
    violations: list[str] = []
    host_fields = _missing_output_fields(content, ANSIBLE_HOSTS_OUTPUT_NAME, ("name", "address"))
    if host_fields:
        violations.append(
            f'modules/{module}/outputs.tf output "{ANSIBLE_HOSTS_OUTPUT_NAME}" missing fields: {", ".join(host_fields)}'
        )
    if require_target_contract:
        target_fields = _missing_output_fields(
            content, CONFIGURATION_TARGETS_OUTPUT_NAME, TARGET_CONTRACT_REQUIRED_FIELDS
        )
        if target_fields:
            violations.append(
                f'modules/{module}/outputs.tf output "{CONFIGURATION_TARGETS_OUTPUT_NAME}" missing fields: '
                f'{", ".join(target_fields)}'
            )
    return violations


def _canonical_target_contract_issue(project_root: Path) -> str | None:
    content = _read_text(project_root / "stacks" / "main" / "outputs.tf")
    if not content:
        return "stacks/main/outputs.tf missing readable content"
    block = _extract_output_block(content, CANONICAL_TARGET_CONTRACT_OUTPUT_NAME)
    if block is None or CONFIGURATION_TARGETS_OUTPUT_NAME in block:
        return None
    return (
        f'stacks/main/outputs.tf output "{CANONICAL_TARGET_CONTRACT_OUTPUT_NAME}" must reference '
        f'"{CONFIGURATION_TARGETS_OUTPUT_NAME}"'
    )


def _playbook_role_names(content: str) -> set[str]:
    roles: set[str] = set()
    in_roles = False
    for line in content.splitlines():
        if _ROLES_HEADER_RE.match(line):
            in_roles = True
            continue
        if not in_roles:
            continue
        if line.strip() and not line.startswith((" ", "\t", "-")):
            in_roles = False
            continue
        item = _ROLE_ITEM_RE.match(line) or _ROLE_SHORT_RE.match(line)
        if item:
            roles.add(item.group(1).strip())
    return roles


def _sanitize_module_list(raw: list[str] | None) -> list[str]:
    if not raw:
        return []
    sanitized: list[str] = []
    for module in raw:
        if not isinstance(module, str):
            continue
        value = module.strip()
        if value and _SAFE_MODULE_RE.match(value):
            sanitized.append(value)
    return sanitized


def _validate_modules(
    project_root: Path,
    modules: list[str],
    *,
    require_ansible: bool,
    require_target_contract: bool,
) -> tuple[list[str], list[str]]:
    missing: list[str] = []
    violations: list[str] = []
    for module in modules:
        missing.extend(_missing_module_files(project_root, module))
        example_issue = _example_contract_issue(project_root, module)
        if example_issue:
            violations.append(example_issue)
        output_issue = _missing_output_contract(project_root, module)
        if output_issue:
            violations.append(output_issue)
        violations.extend(
            _output_field_violations(
                project_root,
                module,
                require_target_contract=require_target_contract,
            )
        )
        if require_target_contract:
            target_issue = _missing_target_contract_output(project_root, module)
            if target_issue:
                violations.append(target_issue)
        if require_ansible:
            missing.extend(_missing_role_files(project_root, module))
    if require_target_contract:
        stack_issue = _missing_canonical_target_contract(project_root)
        if stack_issue:
            violations.append(stack_issue)
        canonical_issue = _canonical_target_contract_issue(project_root)
        if canonical_issue:
            violations.append(canonical_issue)
    return missing, violations


def _validate_playbook_roles(project_root: Path, modules: list[str]) -> tuple[list[str], list[str]]:
    missing: list[str] = []
    violations: list[str] = []
    playbook = project_root / ANSIBLE_PLAYBOOK_PATH
    if not playbook.is_file():
        missing.append(ANSIBLE_PLAYBOOK_PATH)
        return missing, violations
    content = _read_text(playbook)
    if not _HOSTS_HEADER_RE.search(content):
        violations.append(f"{ANSIBLE_PLAYBOOK_PATH} missing a hosts entry")
    if not _ROLES_HEADER_RE.search(content):
        violations.append(f"{ANSIBLE_PLAYBOOK_PATH} missing roles section")
    roles = _playbook_role_names(content)
    for module in modules:
        if module not in roles:
            violations.append(f"{ANSIBLE_PLAYBOOK_PATH} missing role entry for module '{module}'")
    return missing, violations


def _validate_role_task_files(project_root: Path, modules: list[str]) -> list[str]:
    violations: list[str] = []
    for module in modules:
        task_file = project_root / "roles" / module / "tasks" / "main.yml"
        if not task_file.is_file():
            continue
        if not _TASK_NAME_RE.search(_read_text(task_file)):
            violations.append(f"roles/{module}/tasks/main.yml must define at least one named task list item")
    return violations


def validate_iac_structure(
    project_root: Path,
    selected_modules: list[str] | None = None,
    *,
    require_ansible: bool = True,
    require_target_contract: bool | None = None,
) -> dict[str, Any]:
    target_contract_required = require_ansible if require_target_contract is None else require_target_contract
    requested = _sanitize_module_list(selected_modules)
    modules, unknown = _module_targets(project_root, requested)
    missing, violations = _validate_modules(
        project_root,
        modules,
        require_ansible=require_ansible,
        require_target_contract=target_contract_required,
    )
    if require_ansible:
        playbook_missing, playbook_violations = _validate_playbook_roles(project_root, modules)
        missing.extend(playbook_missing)
        violations.extend(playbook_violations)
        violations.extend(_validate_role_task_files(project_root, modules))
    if not modules:
        violations.append("No Terraform modules found under modules/.")
    for module in unknown:
        violations.append(f"Requested module '{module}' was not found under modules/.")
    return {
        "status": "pass" if not missing and not violations else "fail",
        "checked_modules": modules,
        "missing": sorted(set(missing)),
        "violations": violations,
        "require_ansible": require_ansible,
        "require_target_contract": target_contract_required,
        "required": {
            "terraform_files": list(TERRAFORM_REQUIRED_FILES),
            "optional_terraform_files": list(TERRAFORM_OPTIONAL_FILES),
            "ansible_playbook": ANSIBLE_PLAYBOOK_PATH,
            "ansible_role_files": [item.replace("{module}", "<module>") for item in ANSIBLE_ROLE_REQUIRED_FILES],
            "ansible_required_when": "configuration targets or explicit post-provision configuration are needed",
            "required_output": ANSIBLE_HOSTS_OUTPUT_NAME,
            "module_target_output": CONFIGURATION_TARGETS_OUTPUT_NAME,
            "canonical_target_output": CANONICAL_TARGET_CONTRACT_OUTPUT_NAME,
            "target_contract_schema_version": TARGET_CONTRACT_SCHEMA_VERSION,
            "target_contract_required_fields": list(TARGET_CONTRACT_REQUIRED_FIELDS),
            "target_contract_optional_fields": list(TARGET_CONTRACT_OPTIONAL_FIELDS),
            "target_contract_dedupe_key": TARGET_CONTRACT_DEDUPE_KEY,
        },
    }


__all__ = [
    "ANSIBLE_HOSTS_OUTPUT_NAME",
    "ANSIBLE_PLAYBOOK_PATH",
    "ANSIBLE_ROLE_REQUIRED_FILES",
    "CANONICAL_TARGET_CONTRACT_OUTPUT_NAME",
    "CONFIGURATION_TARGETS_OUTPUT_NAME",
    "TERRAFORM_OPTIONAL_FILES",
    "TERRAFORM_REQUIRED_FILES",
    "TARGET_CONTRACT_DEDUPE_KEY",
    "TARGET_CONTRACT_OPTIONAL_FIELDS",
    "TARGET_CONTRACT_REQUIRED_FIELDS",
    "TARGET_CONTRACT_SCHEMA_VERSION",
    "build_template_contract_markdown",
    "provider_credential_vars",
    "validate_iac_structure",
]
