from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.services.agent.runtime.iac_templates import validate_iac_structure


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _module_files(module: str) -> dict[str, str]:
    base = f"modules/{module}"
    return {
        f"{base}/versions.tf": "terraform {}\n",
        f"{base}/providers.tf": 'provider "aws" {}\n',
        f"{base}/main.tf": 'resource "aws_instance" "example" {}\n',
        f"{base}/variables.tf": 'variable "name" { type = string }\n',
        f"{base}/README.md": "# module\n",
        f"{base}/examples/basic/main.tf": f'module "{module}" {{\n  source = "../../"\n}}\n',
    }


def _valid_module_outputs() -> str:
    return "\n".join(
        [
            'output "ansible_hosts" {',
            "  value = []",
            "}",
            "",
            'output "configuration_targets" {',
            "  value = []",
            "}",
            "",
        ]
    )


def _valid_stack_outputs() -> str:
    return "\n".join(
        [
            'output "configuration_target_contract" {',
            "  value = []",
            "}",
            "",
        ]
    )


def _write_valid_project(root: Path, module: str = "web") -> None:
    for relative, content in _module_files(module).items():
        _write(root / relative, content)
    _write(root / f"modules/{module}/outputs.tf", _valid_module_outputs())
    _write(
        root / "playbooks/site.yml",
        "\n".join(["- hosts: all", "  roles:", f"    - role: {module}", ""]),
    )
    _write(root / f"roles/{module}/tasks/main.yml", "- name: configure\n  debug:\n    msg: ok\n")
    _write(root / f"roles/{module}/defaults/main.yml", "---\n{}\n")
    _write(root / "stacks/main/outputs.tf", _valid_stack_outputs())


class IacTemplateGuardrailTests(unittest.TestCase):
    def test_validate_iac_structure_passes_for_valid_project(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_valid_project(root)

            result = validate_iac_structure(
                root,
                selected_modules=["web"],
                require_ansible=True,
                require_target_contract=True,
            )

            self.assertEqual(result["status"], "pass")
            self.assertEqual(result["violations"], [])
            self.assertEqual(result["missing"], [])

    def test_validate_iac_structure_requires_value_assignment_for_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_valid_project(root)
            _write(
                root / "modules/web/outputs.tf",
                "\n".join(['output "ansible_hosts" {', "}", "", 'output "configuration_targets" {', "}", ""]),
            )

            result = validate_iac_structure(root, selected_modules=["web"], require_ansible=False)

            self.assertEqual(result["status"], "fail")
            self.assertIn(
                'modules/web/outputs.tf output "ansible_hosts" missing value assignment', result["violations"]
            )
            self.assertIn(
                'modules/web/outputs.tf output "configuration_targets" missing value assignment',
                result["violations"],
            )

    def test_validate_iac_structure_requires_playbook_hosts_and_role_tasks(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_valid_project(root)
            _write(root / "playbooks/site.yml", "- roles:\n    - role: web\n")
            _write(root / "roles/web/tasks/main.yml", "---\n")

            result = validate_iac_structure(root, selected_modules=["web"], require_ansible=True)

            self.assertEqual(result["status"], "fail")
            self.assertIn("playbooks/site.yml missing a hosts entry", result["violations"])
            self.assertIn("roles/web/tasks/main.yml must declare at least one task item", result["violations"])

    def test_validate_iac_structure_requires_canonical_output_value_assignment(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_valid_project(root)
            _write(root / "stacks/main/outputs.tf", 'output "configuration_target_contract" {\n}\n')

            result = validate_iac_structure(
                root,
                selected_modules=["web"],
                require_ansible=False,
                require_target_contract=True,
            )

            self.assertEqual(result["status"], "fail")
            self.assertIn(
                'stacks/main/outputs.tf output "configuration_target_contract" missing value assignment',
                result["violations"],
            )


if __name__ == "__main__":
    unittest.main()
