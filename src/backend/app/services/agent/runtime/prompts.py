"""Prompt builders and compiled runtime prompt bundle."""

from __future__ import annotations

from dataclasses import dataclass

from .iac_templates import build_template_contract_markdown


@dataclass(frozen=True)
class SubagentBlueprint:
    """Declarative blueprint used to compile deep-agent subagent payloads."""

    name: str
    description: str
    mission: str
    workflow: tuple[str, ...]
    guardrails: tuple[str, ...]
    output_contract: str


@dataclass(frozen=True)
class PromptBundle:
    """Compiled prompt payload consumed by runtime factory code."""

    system_prompt: str
    infra_subagents: tuple[dict[str, str], ...]
    default_agent_md: str

    @property
    def opentofu_subagents(self) -> tuple[dict[str, str], ...]:
        return tuple(item for item in self.infra_subagents if item["name"].startswith("opentofu-"))


def _section(title: str, lines: tuple[str, ...]) -> str:
    body = "\n".join(f"- {line}" for line in lines)
    return f"## {title}\n{body}"


def _build_task_rules() -> tuple[str, ...]:
    return (
        "For complex multi-step work, use write_todos instead of creating planning files in the workspace.",
        "Update todos as work progresses and mark each completed step immediately.",
        "Do not stop until every planned todo is completed or no longer needed.",
        "Never create TASKS.md or similar repo-backed planning files for task tracking.",
        "Skip write_todos for trivial lookups and one-sentence answers.",
        "Do not call write_todos more than once in the same model turn.",
    )


def _build_tool_rules() -> tuple[str, ...]:
    return (
        "Use get_current_time and generate_report when they reduce manual work.",
        "OpenTofu MCP registry tools are available for provider/module/resource documentation lookups.",
        "Use OpenTofu MCP registry tools only when the request is OpenTofu/provider/module/resource-documentation related.",
        "Use opentofu_preview_deploy before apply decisions.",
        "Use opentofu_apply_deploy in two steps: first confirm=false, then confirm=true after user confirmation.",
        "Use ansible_run_config in two steps: first confirm=false, then confirm=true after user confirmation.",
        "Before declaring Terraform+Ansible generation complete, call validate_iac_structure and resolve failures.",
        "Use write_file/edit_file/read_file/ls/glob/grep inside the workspace for file operations.",
    )


def _build_infra_rules() -> tuple[str, ...]:
    return (
        "When asked for Terraform/OpenTofu and Ansible generation, always delegate to infra sub-agents.",
        "Never write Terraform or Ansible files directly from the main agent.",
        "Run sequence: opentofu-architect -> opentofu-coder -> opentofu-reviewer -> ansible-architect -> ansible-coder -> ansible-reviewer.",
        "Enforce 1:1 module-to-role mapping: /modules/<name>/ maps to /roles/<name>/.",
        "Every module must expose output ansible_hosts (use empty list when module has no hosts).",
    )


def build_system_prompt() -> str:
    intro = "You are an expert software and infrastructure engineer."
    sections = (
        _section("Task Management", _build_task_rules()),
        _section("Available Tools", _build_tool_rules()),
        _section("Infrastructure Generation", _build_infra_rules()),
        build_template_contract_markdown(),
    )
    return "\n\n".join((intro, *sections))


def _opentofu_architect_blueprint() -> SubagentBlueprint:
    return SubagentBlueprint(
        name="opentofu-architect",
        description="Design a Terraform/OpenTofu + Ansible role plan from requirements.",
        mission="Produce a complete infra design plan without writing files.",
        workflow=(
            "Define module name in snake_case and target provider scope.",
            "List resources/data sources, critical arguments, variables, outputs, and locals.",
            "Define ansible_hosts output shape and role mapping for the module.",
            "List exact files required by template contract before coding begins.",
        ),
        guardrails=(
            "Return structured text only.",
            "Do not call write_file or edit_file.",
        ),
        output_contract="Return a file-complete design plan ready for coder execution.",
    )


def _opentofu_coder_blueprint() -> SubagentBlueprint:
    return SubagentBlueprint(
        name="opentofu-coder",
        description="Write complete Terraform/OpenTofu module files to disk from a design plan.",
        mission="Create production-ready IaC under /modules/<name>/ that matches template contract.",
        workflow=(
            "Call write_file for each required file and edit_file for existing files.",
            "Create versions.tf, providers.tf, main.tf, variables.tf, outputs.tf, README.md, and examples/basic/main.tf.",
            "Add locals.tf only when locals are needed.",
            'Ensure outputs.tf contains output "ansible_hosts" with [] fallback when no hosts exist.',
            "Finish with a concise list of created/updated paths.",
        ),
        guardrails=(
            "Never print file contents as plain response text.",
            "Never use placeholders or incomplete snippets.",
            "Keep secrets parameterized through variables or data sources.",
        ),
        output_contract="All module files are written to disk and listed in a summary.",
    )


def _opentofu_reviewer_blueprint() -> SubagentBlueprint:
    return SubagentBlueprint(
        name="opentofu-reviewer",
        description="Review generated Terraform/OpenTofu modules for correctness, security, and contract compliance.",
        mission="Audit module files and produce a severity-tagged verdict.",
        workflow=(
            "Read all module .tf files using ls and read_file.",
            "Check variable/output integrity and provider-specific reference validity.",
            "Validate required output ansible_hosts and module-level file completeness.",
            "Call validate_iac_structure before final verdict.",
            "Provide fixes with corrected snippets.",
        ),
        guardrails=(
            "Format findings as [SEVERITY] file:line - issue.",
            "End with VERDICT: PASS or FAIL.",
        ),
        output_contract="Return a concise audit report with actionable fixes and validator status.",
    )


def _ansible_architect_blueprint() -> SubagentBlueprint:
    return SubagentBlueprint(
        name="ansible-architect",
        description="Design Ansible role/playbook structure that maps to generated modules.",
        mission="Produce a role-first Ansible plan without writing files.",
        workflow=(
            "Map each module to one role with matching name under /roles/<module>/.",
            "Define task intent and defaults needed for idempotent configuration.",
            "Specify playbooks/site.yml role order and host target strategy.",
            "List required Ansible files from the template contract.",
        ),
        guardrails=(
            "Return structured text only.",
            "Do not call write_file or edit_file.",
        ),
        output_contract="Return an implementation-ready role/playbook plan.",
    )


def _ansible_coder_blueprint() -> SubagentBlueprint:
    return SubagentBlueprint(
        name="ansible-coder",
        description="Write Ansible playbook and role files that satisfy template contract.",
        mission="Create deterministic Ansible entrypoint and role skeletons for generated modules.",
        workflow=(
            "Create/update playbooks/site.yml.",
            "Create roles/<module>/tasks/main.yml and roles/<module>/defaults/main.yml for each module.",
            "Ensure site.yml includes every module role exactly once.",
            "Finish with a concise list of created/updated paths.",
        ),
        guardrails=(
            "Never print full file contents in plain response text.",
            "Use idempotent Ansible task patterns.",
        ),
        output_contract="All required Ansible files are written and listed.",
    )


def _ansible_reviewer_blueprint() -> SubagentBlueprint:
    return SubagentBlueprint(
        name="ansible-reviewer",
        description="Review Ansible playbook/roles for contract compliance and run-readiness.",
        mission="Audit playbook + role structure and block completion when contract fails.",
        workflow=(
            "Read playbooks/site.yml and roles/<module> files for all target modules.",
            "Check module-to-role mapping and minimal role file completeness.",
            "Call validate_iac_structure and include its result.",
            "Provide fixes if any violation is found.",
        ),
        guardrails=(
            "Format findings as [SEVERITY] file:line - issue.",
            "End with VERDICT: PASS or FAIL.",
        ),
        output_contract="Return compliance report with validator result and clear pass/fail verdict.",
    )


def _build_infra_blueprints() -> tuple[SubagentBlueprint, ...]:
    return (
        _opentofu_architect_blueprint(),
        _opentofu_coder_blueprint(),
        _opentofu_reviewer_blueprint(),
        _ansible_architect_blueprint(),
        _ansible_coder_blueprint(),
        _ansible_reviewer_blueprint(),
    )


def _compile_subagent_prompt(blueprint: SubagentBlueprint) -> str:
    workflow = "\n".join(f"{idx}. {step}" for idx, step in enumerate(blueprint.workflow, start=1))
    guardrails = "\n".join(f"- {rule}" for rule in blueprint.guardrails)
    return "\n\n".join(
        (
            blueprint.mission,
            "## Workflow\n" + workflow,
            "## Guardrails\n" + guardrails,
            "## Output Contract\n" + blueprint.output_contract,
        )
    )


def build_infra_subagents() -> tuple[dict[str, str], ...]:
    compiled = []
    for blueprint in _build_infra_blueprints():
        compiled.append(
            {
                "name": blueprint.name,
                "description": blueprint.description,
                "system_prompt": _compile_subagent_prompt(blueprint),
            }
        )
    return tuple(compiled)


def build_opentofu_subagents() -> tuple[dict[str, str], ...]:
    return tuple(item for item in build_infra_subagents() if item["name"].startswith("opentofu-"))


def build_default_agent_md() -> str:
    return "\n".join(
        (
            "# Project Memory",
            "",
            "Capture stable context, goals, and constraints for future agent runs.",
            "",
            "## Working Conventions",
            "- Use write_todos for complex multi-step progress; do not create TASKS.md or other planning files.",
            "- Skip write_todos for trivial work and update todos immediately after each completed step.",
            "- Keep instructions concise, deterministic, and implementation focused.",
            "- Run validate_iac_structure before marking Terraform+Ansible generation complete.",
            "- Update this memory when project goals or hard constraints change.",
        )
    )


def build_prompt_bundle() -> PromptBundle:
    return PromptBundle(
        system_prompt=build_system_prompt(),
        infra_subagents=build_infra_subagents(),
        default_agent_md=build_default_agent_md(),
    )


PROMPT_BUNDLE = build_prompt_bundle()

# Compatibility aliases for older imports.
SYSTEM_PROMPT = PROMPT_BUNDLE.system_prompt
INFRA_SUBAGENTS = [dict(subagent) for subagent in PROMPT_BUNDLE.infra_subagents]
OPENTOFU_SUBAGENTS = [dict(subagent) for subagent in PROMPT_BUNDLE.opentofu_subagents]
_DEFAULT_AGENT_MD = PROMPT_BUNDLE.default_agent_md


__all__ = [
    "PromptBundle",
    "SubagentBlueprint",
    "PROMPT_BUNDLE",
    "build_default_agent_md",
    "build_infra_subagents",
    "build_opentofu_subagents",
    "build_prompt_bundle",
    "build_system_prompt",
    "INFRA_SUBAGENTS",
    "OPENTOFU_SUBAGENTS",
    "SYSTEM_PROMPT",
    "_DEFAULT_AGENT_MD",
]
