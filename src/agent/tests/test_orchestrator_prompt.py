import unittest

from agents.orchestator.system_prompt import repo_prompt


class OrchestratorPromptTests(unittest.TestCase):
    def test_reviewer_delegation_uses_paths_not_file_snapshots(self):
        prompt = repo_prompt({"fullName": "owner/repo"})

        self.assertIn("pass the user's original goal", prompt)
        self.assertIn("changed or relevant file paths", prompt)
        self.assertIn("do not paste whole current files or file snapshots", prompt)
        self.assertIn("reviewer_agent can read the filesystem", prompt)


if __name__ == "__main__":
    unittest.main()
