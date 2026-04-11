from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from app.services.agent.runtime.config_loader import build_runtime_subagents, load_runtime_config
from app.services.agent.runtime.factory import _runtime_backend, _runtime_system_prompt


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _settings(async_enabled: bool, graph_ids: dict[str, str] | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        agent_async_subagents_enabled=async_enabled,
        agent_async_subagents_url="https://subagents.example.com",
        async_subagent_graph_ids=lambda: graph_ids or {},
        async_subagent_headers=lambda: {"authorization": "Bearer token"},
    )


class AgentConfigLoaderTests(unittest.TestCase):
    def test_load_runtime_config_discovers_root_and_subagent_skills(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            config_dir = Path(tmp)
            _write(config_dir / "AGENTS.md", "# Memory\n")
            _write(
                config_dir / "skills" / "planning" / "SKILL.md",
                "---\nname: planning\ndescription: Make a plan\n---\n",
            )
            _write(
                config_dir / "subagents" / "opentofu-reviewer" / "AGENTS.md",
                "\n".join(
                    [
                        "---",
                        "name: opentofu-reviewer",
                        "description: Review OpenTofu output",
                        "skills:",
                        "  - infra-validation",
                        "  - ./skills/",
                        "---",
                        "Review generated OpenTofu code.",
                    ]
                ),
            )
            _write(
                config_dir / "subagents" / "opentofu-reviewer" / "skills" / "review-focus" / "SKILL.md",
                "---\nname: review-focus\n---\n",
            )
            _write(config_dir / "skills" / "infra-validation" / "SKILL.md", "---\nname: infra-validation\n---\n")

            runtime_config = load_runtime_config(config_dir)

            self.assertEqual(runtime_config.memory_paths, ["/.agent-config/AGENTS.md"])
            self.assertEqual(runtime_config.skill_paths, ["/.agent-config/skills/"])
            self.assertEqual(
                runtime_config.skills,
                [
                    {
                        "name": "infra-validation",
                        "description": "Skill infra-validation",
                        "path": "/.agent-config/skills/infra-validation/",
                    },
                    {
                        "name": "planning",
                        "description": "Make a plan",
                        "path": "/.agent-config/skills/planning/",
                    },
                ],
            )
            self.assertEqual(len(runtime_config.subagents), 1)
            subagent = runtime_config.subagents[0]
            self.assertEqual(subagent["name"], "opentofu-reviewer")
            self.assertEqual(
                subagent["skills"],
                [
                    "/.agent-config/skills/infra-validation/",
                    "/.agent-config/subagents/opentofu-reviewer/skills/",
                ],
            )

    def test_runtime_backend_exposes_internal_agent_config_as_read_only(self) -> None:
        with tempfile.TemporaryDirectory() as project_tmp, tempfile.TemporaryDirectory() as config_tmp:
            config_dir = Path(config_tmp)
            _write(config_dir / "AGENTS.md", "# Internal instructions\n")
            backend = _runtime_backend(project_tmp, config_tmp)

            read_result = backend.read("/.agent-config/AGENTS.md")
            write_result = backend.write("/.agent-config/AGENTS.md", "# Updated\n")
            edit_result = backend.edit("/.agent-config/AGENTS.md", "Internal", "External")

            self.assertIn("Internal instructions", read_result.file_data["content"])
            self.assertIn("read-only", write_result.error)
            self.assertIn("read-only", edit_result.error)

    def test_runtime_cache_token_changes_when_config_changes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            config_dir = Path(tmp)
            _write(config_dir / "AGENTS.md", "# Memory\n")
            initial = load_runtime_config(config_dir).cache_token

            _write(config_dir / "AGENTS.md", "# Memory updated\n")
            changed = load_runtime_config(config_dir).cache_token

            self.assertNotEqual(initial, changed)

    def test_runtime_system_prompt_discourages_eager_skill_enumeration(self) -> None:
        prompt = _runtime_system_prompt()

        self.assertIn("Do not inspect `/.agent-config/`", prompt)
        self.assertIn("open only the minimal `SKILL.md` files", prompt)
        self.assertIn("about to delegate to that subagent", prompt)

    def test_runtime_system_prompt_lists_available_skills_tools_and_subagents(self) -> None:
        runtime_config = load_runtime_config()

        class FakeTool:
            name = "validate_iac_structure"
            description = "Validate Terraform + optional Ansible file structure against the template contract."

        prompt = _runtime_system_prompt(runtime_config, [FakeTool()])

        self.assertIn("Available capabilities in this session:", prompt)
        self.assertIn("Skills:", prompt)
        self.assertIn("terraform-generate", prompt)
        self.assertIn("Tools:", prompt)
        self.assertIn("validate_iac_structure", prompt)
        self.assertIn("Subagents:", prompt)
        self.assertIn("opentofu-coder", prompt)

    def test_build_runtime_subagents_switches_to_async_specs(self) -> None:
        subagents = [
            {
                "name": "opentofu-coder",
                "description": "Write OpenTofu code",
                "system_prompt": "Generate files.",
            }
        ]

        compiled = build_runtime_subagents(
            _settings(True, {"opentofu-coder": "graph-tofu-coder"}),
            subagents,
        )

        self.assertEqual(
            compiled,
            [
                {
                    "name": "opentofu-coder",
                    "description": "Write OpenTofu code",
                    "graph_id": "graph-tofu-coder",
                    "url": "https://subagents.example.com",
                    "headers": {"authorization": "Bearer token"},
                }
            ],
        )


if __name__ == "__main__":
    unittest.main()
