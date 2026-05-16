import unittest

from agents.orchestator.system_prompt import repo_prompt


class OrchestratorPromptTests(unittest.TestCase):
    def test_reviewer_delegation_uses_paths_not_file_snapshots(self):
        prompt = repo_prompt({"fullName": "owner/repo"})

        self.assertIn("pass the user's original goal", prompt)
        self.assertIn("changed or relevant file paths", prompt)
        self.assertIn("do not paste whole current files or file snapshots", prompt)
        self.assertIn("reviewer_agent can read the filesystem", prompt)

    def test_repository_prompt_keeps_runtime_artifacts_out_of_repo(self):
        prompt = repo_prompt({"fullName": "owner/repo"})

        self.assertIn("Runtime artifacts such as pasted images", prompt)
        self.assertIn("generated architecture diagram YAML", prompt)
        self.assertIn("do not copy or add those artifact files to the repository", prompt)
        self.assertIn("You may read explicitly provided session artifact paths outside the repository", prompt)

    def test_no_repository_prompt_allows_writable_filesystem_workspace(self):
        prompt = repo_prompt(None)

        self.assertIn("per-session writable filesystem workspace", prompt)
        self.assertIn("Do not require a GitHub repository before writing files", prompt)
        self.assertIn("delegate requested code, Terraform/OpenTofu, script, or test file creation", prompt)
        self.assertIn("engineer_agent", prompt)
        self.assertIn("pull requests, commits, repository diffs", prompt)
        self.assertNotIn("requires repository access, explain that they can connect", prompt)

    def test_terraform_generation_requires_engineer_reviewer_fix_loop(self):
        prompt = repo_prompt({"fullName": "owner/repo"})

        self.assertIn("For Terraform/OpenTofu code creation or modification", prompt)
        self.assertIn("implementation-review-fix loop", prompt)
        self.assertIn("delegate the initial HCL/file creation to `engineer_agent`", prompt)
        self.assertIn("delegate a correctness review of the changed file paths to `reviewer_agent`", prompt)
        self.assertIn("delegate those findings and the affected paths back to `engineer_agent` for fixes", prompt)
        self.assertIn("repeat reviewer -> engineer fix until reviewer reports no blocking findings", prompt)
        self.assertIn("Do not finalize Terraform/OpenTofu code generation after only the first engineer pass", prompt)
        self.assertIn("complete the required engineer_agent implementation, reviewer_agent review, and engineer_agent fix loop", prompt)


if __name__ == "__main__":
    unittest.main()
