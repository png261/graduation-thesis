"""OpenTofu/Terraform registry guidance tool.

The production runtime must not fail startup when an external registry MCP
server is unavailable, so this module exposes a lightweight Strands tool that
keeps Terraform guidance available alongside the packaged skill.
"""

from __future__ import annotations

from strands import tool


def create_opentofu_mcp_client():
    """Return a Terraform/OpenTofu registry guidance tool."""

    @tool
    def opentofu_registry_docs(topic: str) -> str:
        """Provide registry lookup guidance for Terraform/OpenTofu providers and modules.

        Args:
            topic: Provider, resource, data source, or module to look up.
        """
        clean_topic = (topic or "").strip()
        if not clean_topic:
            clean_topic = "the provider, resource, data source, or module in question"
        return (
            "Use the Terraform/OpenTofu skill and verify provider schemas before authoring HCL. "
            f"For {clean_topic}, check the official Terraform Registry or OpenTofu Registry documentation, "
            "confirm required arguments, optional arguments, nested blocks, import/state behavior, "
            "provider version constraints, and examples before producing final code."
        )

    return opentofu_registry_docs
