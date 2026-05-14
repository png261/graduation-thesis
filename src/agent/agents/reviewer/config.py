"""Reviewer agent configuration."""

NAME = "reviewer_agent"
DESCRIPTION = "Reviews code and infrastructure changes for correctness, regressions, and missing tests."
TOOL_NAMES = (
    "opentofu",
    "file_read",
    "terraform_validate",
    "tflint_scan",
)
