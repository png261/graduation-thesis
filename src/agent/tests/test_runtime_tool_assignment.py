import unittest

from agents.cost_capacity.config import TOOL_NAMES as COST_TOOLS
from agents.devops.config import TOOL_NAMES as DEVOPS_TOOLS
from agents.engineer.config import TOOL_NAMES as ENGINEER_TOOLS
from agents.reviewer.config import TOOL_NAMES as REVIEWER_TOOLS
from agents.security_prover.config import TOOL_NAMES as SECURITY_TOOLS


class RuntimeToolAssignmentTests(unittest.TestCase):
    def test_engineer_has_read_write_and_opentofu_tools(self):
        self.assertIn("file_read", ENGINEER_TOOLS)
        self.assertIn("file_write", ENGINEER_TOOLS)
        self.assertIn("opentofu", ENGINEER_TOOLS)
        self.assertIn("terraform_validate", ENGINEER_TOOLS)

    def test_reviewer_has_validation_and_tflint_without_write_tool(self):
        self.assertIn("file_read", REVIEWER_TOOLS)
        self.assertIn("terraform_validate", REVIEWER_TOOLS)
        self.assertIn("tflint_scan", REVIEWER_TOOLS)
        self.assertNotIn("file_write", REVIEWER_TOOLS)

    def test_finops_security_and_devops_have_specialized_tools(self):
        self.assertIn("infracost_breakdown", COST_TOOLS)
        self.assertIn("checkov_scan", SECURITY_TOOLS)
        self.assertIn("terraform_init", DEVOPS_TOOLS)
        self.assertIn("terraform_plan", DEVOPS_TOOLS)
        self.assertIn("terraform_validate", DEVOPS_TOOLS)


if __name__ == "__main__":
    unittest.main()
