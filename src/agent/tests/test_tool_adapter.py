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

    def test_preserves_multimodal_context_for_specialist_delegation(self):
        image_bytes = b"fake-image"
        result = _with_original_user_prompt(
            "Draw from the pasted image.",
            "Ask architect_agent to inspect the diagram.",
            original_context=[
                {"text": "Draw from the pasted image.\n\nThe user attached the following file(s)."},
                {"image": {"format": "png", "source": {"bytes": image_bytes}}},
            ],
        )

        self.assertIsInstance(result, list)
        self.assertEqual(result[0]["text"], "Draw from the pasted image.\n\nThe user attached the following file(s).")
        self.assertEqual(result[1]["image"]["source"]["bytes"], image_bytes)
        self.assertEqual(result[2]["text"], "Orchestrator delegation:\nAsk architect_agent to inspect the diagram.")

    def test_restores_json_safe_multimodal_context_for_specialist_delegation(self):
        result = _with_original_user_prompt(
            "Draw from the pasted image.",
            "Ask architect_agent to inspect the diagram.",
            original_context=[
                {"text": "Draw from the pasted image.\n\nThe user attached the following file(s)."},
                {
                    "image": {
                        "format": "png",
                        "source": {"bytes": {"__bytes_base64__": "ZmFrZS1pbWFnZQ=="}},
                    }
                },
            ],
        )

        self.assertIsInstance(result, list)
        self.assertEqual(result[1]["image"]["source"]["bytes"], b"fake-image")
        self.assertEqual(result[2]["text"], "Orchestrator delegation:\nAsk architect_agent to inspect the diagram.")

    def test_does_not_duplicate_delegation_in_multimodal_context(self):
        context = [
            {
                "text": (
                    "Original user prompt.\n\n"
                    "Orchestrator delegation:\nCheck the pasted image."
                )
            }
        ]

        self.assertEqual(
            _with_original_user_prompt("Original user prompt.", "Check the pasted image.", original_context=context),
            context,
        )


if __name__ == "__main__":
    unittest.main()
