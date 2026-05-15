"""Reviewer agent configuration."""

NAME = "reviewer_agent"
DESCRIPTION = "Reviews code and infrastructure changes for correctness, regressions, and missing tests."
TOOL_NAMES = (
    "handoff_to_user",
    "opentofu",
    "file_read",
    "terraform_validate",
    "tflint_scan",
)
