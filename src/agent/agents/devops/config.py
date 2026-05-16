"""DevOps agent configuration."""

NAME = "devops_agent"
DESCRIPTION = "Handles CI/CD, deployment structure, tests, observability, and operational readiness."
TOOL_NAMES = (
    "gateway",
    "handoff_to_user",
    "opentofu",
    "file_read",
    "file_write",
    "terraform_init",
    "terraform_plan",
    "terraform_validate",
    "ministack_terratest",
)
