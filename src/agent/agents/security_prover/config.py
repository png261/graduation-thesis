"""Security prover agent configuration."""

NAME = "security_prover_agent"
DESCRIPTION = "Checks IAM, network exposure, encryption, secret handling, and security evidence."
TOOL_NAMES = (
    "gateway",
    "handoff_to_user",
    "opentofu",
    "file_read",
    "checkov_scan",
)
