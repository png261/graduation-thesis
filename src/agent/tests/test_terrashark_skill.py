import unittest
from pathlib import Path

from agents.skills.terrashark_plugin import TERRASHARK_SKILL_DIR, create_terrashark_plugin


class TerraSharkSkillTests(unittest.TestCase):
    def test_terrashark_skill_metadata_and_references_are_available(self):
        plugin = create_terrashark_plugin()
        skills = plugin.get_available_skills()

        self.assertEqual(len(skills), 1)
        self.assertEqual(skills[0].name, "terrashark")
        self.assertIn("Terraform/OpenTofu", skills[0].description)
        self.assertTrue((TERRASHARK_SKILL_DIR / "references" / "ci-drift.md").is_file())
        self.assertTrue((TERRASHARK_SKILL_DIR / "references" / "conditional" / "backend-state-safety.md").is_file())

    def test_zip_packager_keeps_terrashark_reference_resources(self):
        backend_stack = Path(__file__).resolve().parents[2] / "infra-cdk" / "lib" / "backend-stack.ts"
        content = backend_stack.read_text(encoding="utf-8")

        self.assertNotIn('entry.name === "references" && relativePath.includes("skills/terrashark")', content)
        self.assertNotIn('entry.name === "LICENSE" && relativePath.includes("skills/terrashark")', content)

    def test_all_agent_factories_attach_terrashark_plugin(self):
        agents_root = Path(__file__).resolve().parents[1] / "agents"
        agent_files = [
            agents_root / "architect" / "agent.py",
            agents_root / "engineer" / "agent.py",
            agents_root / "reviewer" / "agent.py",
            agents_root / "cost_capacity" / "agent.py",
            agents_root / "security_prover" / "agent.py",
            agents_root / "devops" / "agent.py",
            agents_root / "orchestator" / "agent.py",
        ]

        for agent_file in agent_files:
            with self.subTest(agent=str(agent_file.relative_to(agents_root))):
                content = agent_file.read_text(encoding="utf-8")
                self.assertIn("from agents.skills.terrashark_plugin import create_terrashark_plugin", content)
                self.assertIn("plugins=[create_terrashark_plugin()]", content)


if __name__ == "__main__":
    unittest.main()
