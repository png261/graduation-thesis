from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.services.agent.runtime.iac_templates import validate_iac_structure


def _write(root: Path, relative: str, content: str) -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _module_outputs(*, include_targets: bool = True, ansible_hosts: str | None = None) -> str:
    host_value = ansible_hosts or """
output "ansible_hosts" {
  value = [
    {
      name    = "web"
      address = "i-123456"
      groups  = ["web"]
    }
  ]
}
""".strip()
    target_value = """
output "configuration_targets" {
  value = [
    {
      execution_id   = "i-123456"
      role           = "web"
      source_modules = ["web"]
    }
  ]
}
""".strip()
    blocks = [host_value]
    if include_targets:
        blocks.append(target_value)
    return "\n\n".join(blocks) + "\n"


def _stack_outputs(*, include_canonical: bool = True) -> str:
    if not include_canonical:
        return 'output "instance_id" {\n  value = module.web.instance_id\n}\n'
    return """
output "configuration_target_contract" {
  value = module.web.configuration_targets
}
""".strip() + "\n"


def _scaffold_project(
    root: Path,
    *,
    require_ansible: bool = True,
    include_targets: bool = True,
    include_canonical: bool = True,
    example_source: str = "../../",
    task_body: str = "---\n- name: Configure host\n  ansible.builtin.debug:\n    msg: ok\n",
) -> None:
    module_files = {
        "modules/web/versions.tf": 'terraform {\n  required_version = ">= 1.6.0"\n}\n',
        "modules/web/providers.tf": 'provider "aws" {}\n',
        "modules/web/main.tf": 'resource "aws_instance" "web" {}\n',
        "modules/web/variables.tf": 'variable "instance_type" { type = string }\n',
        "modules/web/outputs.tf": _module_outputs(include_targets=include_targets),
        "modules/web/README.md": "# web\n",
        "modules/web/examples/basic/main.tf": (
            f'module "web" {{\n  source = "{example_source}"\n  instance_type = "t3.micro"\n}}\n'
        ),
    }
    for relative, content in module_files.items():
        _write(root, relative, content)

    if require_ansible:
        _write(
            root,
            "playbooks/site.yml",
            ("- name: Configure web\n" "  hosts: web\n" "  gather_facts: false\n" "  roles:\n" "    - role: web\n"),
        )
        _write(root, "roles/web/tasks/main.yml", task_body)
        _write(root, "roles/web/defaults/main.yml", "---\ndemo_title: demo\n")
        _write(root, "stacks/main/outputs.tf", _stack_outputs(include_canonical=include_canonical))


class ValidateIacStructureTests(unittest.TestCase):
    def test_passes_for_valid_ansible_project(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _scaffold_project(root)

            result = validate_iac_structure(root)

            self.assertEqual(result["status"], "pass")
            self.assertTrue(result["require_target_contract"])
            self.assertEqual(result["missing"], [])
            self.assertEqual(result["violations"], [])

    def test_allows_pure_opentofu_project_without_target_contract_when_ansible_disabled(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _scaffold_project(root, require_ansible=False, include_targets=False, include_canonical=False)

            result = validate_iac_structure(root, require_ansible=False)

            self.assertEqual(result["status"], "pass")
            self.assertFalse(result["require_target_contract"])

    def test_flags_missing_target_contract_outputs_for_ansible_projects(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _scaffold_project(root, include_targets=False, include_canonical=False)

            result = validate_iac_structure(root)

            self.assertEqual(result["status"], "fail")
            self.assertIn('modules/web/outputs.tf missing output "configuration_targets"', result["violations"])
            self.assertIn(
                'stacks/main/outputs.tf missing output "configuration_target_contract"',
                result["violations"],
            )

    def test_flags_invalid_example_source_guardrail(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _scaffold_project(root, example_source="../")

            result = validate_iac_structure(root)

            self.assertEqual(result["status"], "fail")
            self.assertIn(
                'modules/web/examples/basic/main.tf must reference the module with source = "../../"',
                result["violations"],
            )

    def test_flags_ansible_role_without_named_tasks(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _scaffold_project(root, task_body="---\nansible.builtin.debug:\n  msg: missing task list\n")

            result = validate_iac_structure(root)

            self.assertEqual(result["status"], "fail")
            self.assertIn(
                "roles/web/tasks/main.yml must define at least one named task list item",
                result["violations"],
            )


if __name__ == "__main__":
    unittest.main()
