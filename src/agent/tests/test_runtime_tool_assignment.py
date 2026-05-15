import unittest
from types import SimpleNamespace

from agents.architect.config import TOOL_NAMES as ARCHITECT_TOOLS
from agents.cost_capacity.config import TOOL_NAMES as COST_TOOLS
from agents.devops.config import TOOL_NAMES as DEVOPS_TOOLS
from agents.engineer.config import TOOL_NAMES as ENGINEER_TOOLS
from agents.orchestator.config import TOOL_NAMES as ORCHESTRATOR_TOOLS
from agents.orchestator.tool import SPECIALIST_TOOL_FACTORIES, create_tools as create_orchestrator_tools
from agents.reviewer.config import TOOL_NAMES as REVIEWER_TOOLS
from agents.runtime import AgentRuntimeTools
from agents.security_prover.config import TOOL_NAMES as SECURITY_TOOLS


class RuntimeToolAssignmentTests(unittest.TestCase):
    def test_engineer_has_read_write_and_opentofu_tools(self):
        self.assertIn("file_read", ENGINEER_TOOLS)
        self.assertIn("file_write", ENGINEER_TOOLS)
        self.assertIn("opentofu", ENGINEER_TOOLS)
        self.assertIn("handoff_to_user", ENGINEER_TOOLS)
        self.assertIn("terraform_validate", ENGINEER_TOOLS)
        self.assertNotIn("create_pull_request", ENGINEER_TOOLS)

    def test_orchestrator_exposes_only_pull_request_plus_specialist_tools(self):
        self.assertEqual(ORCHESTRATOR_TOOLS, ("handoff_to_user", "create_pull_request"))
        self.assertNotIn("opentofu", ORCHESTRATOR_TOOLS)
        self.assertNotIn("file_write", ORCHESTRATOR_TOOLS)
        self.assertNotIn("file_read", ORCHESTRATOR_TOOLS)
        tools = create_orchestrator_tools(
            model=None,
            runtime_tools=SimpleNamespace(handoff_to_user=None, create_pull_request=None),
            trace_attributes={},
        )
        self.assertEqual(len(tools), len(SPECIALIST_TOOL_FACTORIES))
        self.assertEqual(
            [getattr(tool, "_tool_name", "") for tool in tools],
            [
                "architect_agent",
                "engineer_agent",
                "reviewer_agent",
                "cost_capacity_agent",
                "security_prover_agent",
                "devops_agent",
            ],
        )

    def test_pull_request_tool_is_only_assigned_to_orchestrator(self):
        self.assertIn("create_pull_request", ORCHESTRATOR_TOOLS)
        for tool_names in (ENGINEER_TOOLS, REVIEWER_TOOLS, COST_TOOLS, SECURITY_TOOLS, DEVOPS_TOOLS):
            self.assertNotIn("create_pull_request", tool_names)

    def test_handoff_tool_is_available_to_orchestrator_and_all_specialists(self):
        for tool_names in (
            ORCHESTRATOR_TOOLS,
            ARCHITECT_TOOLS,
            ENGINEER_TOOLS,
            REVIEWER_TOOLS,
            COST_TOOLS,
            SECURITY_TOOLS,
            DEVOPS_TOOLS,
        ):
            self.assertIn("handoff_to_user", tool_names)

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

    def test_raw_shell_tool_is_not_exposed_to_any_agent(self):
        all_tool_sets = (
            ORCHESTRATOR_TOOLS,
            ARCHITECT_TOOLS,
            ENGINEER_TOOLS,
            REVIEWER_TOOLS,
            COST_TOOLS,
            SECURITY_TOOLS,
            DEVOPS_TOOLS,
        )
        for tool_names in all_tool_sets:
            self.assertNotIn("shell", tool_names)
        self.assertNotIn("shell", AgentRuntimeTools.__dataclass_fields__)


if __name__ == "__main__":
    unittest.main()
