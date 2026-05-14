"""Engineer agent configuration."""

NAME = "engineer_agent"
DESCRIPTION = "Implements repository changes, Terraform/OpenTofu code, scripts, tests, and fixes."
TOOL_NAMES = (
    "gateway",
    "opentofu",
    "handoff_to_user",
    "file_read",
    "file_write",
    "terraform_validate",
    "shell",
)
