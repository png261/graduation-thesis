import unittest

from agents.tool_adapter import _with_original_user_prompt


class SpecialistPromptTests(unittest.TestCase):
    def test_prepends_original_user_prompt_to_delegation(self):
        result = _with_original_user_prompt(
            "Review the Terraform changes for regressions.",
            "Check main.tf and variables.tf.",
        )

        self.assertIn("Original user prompt:\nReview the Terraform changes for regressions.", result)
        self.assertIn("Orchestrator delegation:\nCheck main.tf and variables.tf.", result)

    def test_does_not_duplicate_original_prompt(self):
        result = _with_original_user_prompt(
            "Review the Terraform changes.",
            "Original user prompt: Review the Terraform changes. Check file paths only.",
        )

        self.assertEqual(result, "Original user prompt: Review the Terraform changes. Check file paths only.")

    def test_returns_delegation_when_original_prompt_is_missing(self):
        self.assertEqual(_with_original_user_prompt("", "Check the repository."), "Check the repository.")


if __name__ == "__main__":
    unittest.main()
