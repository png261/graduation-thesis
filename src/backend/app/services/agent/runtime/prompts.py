"""Prompt builders and compiled runtime prompt bundle."""
from __future__ import annotations

from dataclasses import dataclass


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
    opentofu_subagents: tuple[dict[str, str], ...]
    default_agent_md: str


def _section(title: str, lines: tuple[str, ...]) -> str:
    body = "\n".join(f"- {line}" for line in lines)
    return f"## {title}\n{body}"


def _build_task_rules() -> tuple[str, ...]:
    return (
        "For multi-step work, create or append TASKS.md before coding.",
        "Execute tasks sequentially and mark each checkbox complete immediately.",
        "Do not stop until every planned checkbox is complete.",
        "After completion, append a short timestamped Done summary in TASKS.md.",
        "Skip TASKS.md only for one-sentence answers and trivial lookups.",
    )


def _build_tool_rules() -> tuple[str, ...]:
    return (
        "Use get_current_time and generate_report when they reduce manual work.",
        "Use opentofu_preview_deploy before apply decisions.",
        "Use opentofu_apply_deploy in two steps: first confirm=false, then confirm=true after user confirmation.",
        "Use write_file/edit_file/read_file/ls/glob/grep inside the workspace for file operations.",
    )


def _build_infra_rules() -> tuple[str, ...]:
    return (
        "When asked for OpenTofu infrastructure, always delegate to OpenTofu sub-agents.",
        "Never write OpenTofu files directly from the main agent.",
        "Run sequence: opentofu-architect -> opentofu-coder -> opentofu-reviewer.",
        "Expect generated modules under /modules/<name>/.",
    )


def build_system_prompt() -> str:
    intro = "You are an expert software and infrastructure engineer."
    sections = (
        _section("Task Management", _build_task_rules()),
        _section("Available Tools", _build_tool_rules()),
        _section("Infrastructure Generation", _build_infra_rules()),
    )
    return "\n\n".join((intro, *sections))


def _opentofu_architect_blueprint() -> SubagentBlueprint:
    return SubagentBlueprint(
        name="opentofu-architect",
        description="Design an OpenTofu module plan from plain-English requirements.",
        mission="Produce a complete module design plan without writing files.",
        workflow=(
            "Define module name in snake_case and module scope.",
            "List resources/data sources and critical arguments.",
            "Specify variables, outputs, provider constraints, and locals.",
            "Include security controls and a minimal usage example.",
        ),
        guardrails=(
            "Return structured text only.",
            "Do not call write_file or edit_file.",
        ),
        output_contract="Return a design plan ready for opentofu-coder execution.",
    )


def _opentofu_coder_blueprint() -> SubagentBlueprint:
    return SubagentBlueprint(
        name="opentofu-coder",
        description="Write complete OpenTofu module files to disk from a design plan.",
        mission="Create production-ready HCL under /modules/<name>/.",
        workflow=(
            "Call write_file for each required file and edit_file for existing files.",
            "Create versions.tf, main.tf, variables.tf, outputs.tf, README.md, and examples/basic/main.tf.",
            "Add locals.tf only when locals are required.",
            "Finish with a concise list of created/updated paths.",
        ),
        guardrails=(
            "Never print file contents as plain response text.",
            "Never use placeholders or incomplete snippets.",
            "Keep secrets parameterized through variables or data sources.",
        ),
        output_contract="All files are written to disk and listed in a summary.",
    )


def _opentofu_reviewer_blueprint() -> SubagentBlueprint:
    return SubagentBlueprint(
        name="opentofu-reviewer",
        description="Review generated OpenTofu modules for correctness and security.",
        mission="Audit module files and produce a severity-tagged verdict.",
        workflow=(
            "Read all module .tf files using ls and read_file.",
            "Check variable/output integrity and reference validity.",
            "Validate baseline security controls and best practices.",
            "Provide fixes with corrected snippets.",
        ),
        guardrails=(
            "Format findings as [SEVERITY] file:line - issue.",
            "End with VERDICT: PASS or FAIL.",
        ),
        output_contract="Return a concise audit report with actionable fixes.",
    )


def _build_opentofu_blueprints() -> tuple[SubagentBlueprint, ...]:
    return (
        _opentofu_architect_blueprint(),
        _opentofu_coder_blueprint(),
        _opentofu_reviewer_blueprint(),
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


def build_opentofu_subagents() -> tuple[dict[str, str], ...]:
    compiled = []
    for blueprint in _build_opentofu_blueprints():
        compiled.append(
            {
                "name": blueprint.name,
                "description": blueprint.description,
                "system_prompt": _compile_subagent_prompt(blueprint),
            }
        )
    return tuple(compiled)


def build_default_agent_md() -> str:
    return "\n".join(
        (
            "# Project Memory",
            "",
            "Capture stable context, goals, and constraints for future agent runs.",
            "",
            "## Working Conventions",
            "- Keep multi-step progress in TASKS.md and retain history across sessions.",
            "- Keep instructions concise, deterministic, and implementation focused.",
            "- Update this memory when project goals or hard constraints change.",
        )
    )


def build_prompt_bundle() -> PromptBundle:
    return PromptBundle(
        system_prompt=build_system_prompt(),
        opentofu_subagents=build_opentofu_subagents(),
        default_agent_md=build_default_agent_md(),
    )


PROMPT_BUNDLE = build_prompt_bundle()

# Compatibility aliases for older imports.
SYSTEM_PROMPT = PROMPT_BUNDLE.system_prompt
OPENTOFU_SUBAGENTS = [dict(subagent) for subagent in PROMPT_BUNDLE.opentofu_subagents]
INFRA_SUBAGENTS = OPENTOFU_SUBAGENTS
_DEFAULT_AGENT_MD = PROMPT_BUNDLE.default_agent_md


__all__ = [
    "PromptBundle",
    "SubagentBlueprint",
    "PROMPT_BUNDLE",
    "build_default_agent_md",
    "build_opentofu_subagents",
    "build_prompt_bundle",
    "build_system_prompt",
    "INFRA_SUBAGENTS",
    "OPENTOFU_SUBAGENTS",
    "SYSTEM_PROMPT",
    "_DEFAULT_AGENT_MD",
]
