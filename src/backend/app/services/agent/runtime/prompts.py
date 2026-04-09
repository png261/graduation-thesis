"""Prompt builders and compiled runtime prompt bundle."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from langchain.agents.middleware import dynamic_prompt
from langchain.agents.middleware.context_editing import ClearToolUsesEdit, ContextEditingMiddleware
from langchain.agents.middleware.types import AgentMiddleware, AgentState, ModelRequest, hook_config
from langchain_core.messages import AIMessage

from .context import AttachmentContext, DeepAgentContext
from .iac_templates import build_template_contract_markdown
from .pii import StructuredPIIMiddleware

_SSN_PATTERN = r"(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)"
_PHONE_PATTERN = r"(?:(?<!\w)(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}(?!\w))"


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
        "For non-trivial OpenTofu work, include an explicit review todo after coding and before completion.",
        "Name the OpenTofu review todo clearly and complete it by running opentofu_validate_review plus validate_iac_structure.",
        "For substantial tasks, finish with an evidence bundle that includes changed files, validations run, pass/fail evidence, unresolved risks, and completion rationale.",
        "Keep evidence bundles lightweight for trivial tasks and one-shot answers.",
    )


def _build_tool_rules() -> tuple[str, ...]:
    return (
        "Use get_current_time and generate_report when they reduce manual work.",
        "OpenTofu MCP registry tools are available for provider/module/resource documentation lookups.",
        "Use OpenTofu MCP registry tools only when the request is OpenTofu/provider/module/resource-documentation related.",
        "Use inspect_opentofu_generated_code, inspect_ansible_generated_code, and search_generated_iac_patterns as supporting evidence during review.",
        "Treat these infra code-intel helpers as supporting evidence only; validate_iac_structure remains the primary IaC validator.",
        "Use opentofu_validate_review during OpenTofu review to catch syntax, init, and module-loading errors.",
        "Use opentofu_preview_deploy before apply decisions.",
        "Use opentofu_apply_deploy in two steps: first confirm=false, then confirm=true after user confirmation.",
        "Use ansible_run_config in two steps: first confirm=false, then confirm=true after user confirmation.",
        "Before declaring OpenTofu generation complete, run both opentofu_validate_review and validate_iac_structure, then resolve failures.",
        "When no configuration targets or post-provision steps are needed, call validate_iac_structure with require_ansible=false.",
        "Use write_file/edit_file/read_file/ls/glob/grep inside the workspace for file operations.",
    )


def _build_infra_rules() -> tuple[str, ...]:
    return (
        "When asked for Terraform/OpenTofu generation, always delegate to infra sub-agents.",
        "Never write Terraform or Ansible files directly from the main agent.",
        "Run sequence: opentofu-architect -> opentofu-coder -> opentofu-reviewer, then invoke ansible-architect -> ansible-coder -> ansible-reviewer only when configuration targets or explicit post-provision configuration are required.",
        "Enforce 1:1 module-to-role mapping only for modules that require configuration.",
        "Every module must expose output ansible_hosts (use empty list when module has no hosts).",
    )


def _build_safety_rules() -> tuple[str, ...]:
    return (
        "Do not ask users to paste real personal data; ask for placeholders or sanitized examples instead.",
        "If personal data appears in the conversation or tool output, treat redacted placeholders as canonical and do not reconstruct the original values.",
        "Limit handling of personal data to the minimum needed to finish the task safely.",
    )


def build_system_prompt() -> str:
    intro = "You are an expert software and infrastructure engineer."
    sections = (
        _section("Task Management", _build_task_rules()),
        _section("Safety", _build_safety_rules()),
        _section("Available Tools", _build_tool_rules()),
        _section("Infrastructure Generation", _build_infra_rules()),
        build_template_contract_markdown(),
    )
    return "\n\n".join((intro, *sections))


def _content_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    return "".join(
        str(item.get("text") or "") for item in content if isinstance(item, dict) and item.get("type") == "text"
    )


def _attachment_line(attachment: AttachmentContext) -> str:
    content_type = attachment.content_type or "unknown"
    return f"- {attachment.kind}: {attachment.name} ({content_type}, {attachment.size_hint} bytes)"


def _attachment_lines(context: DeepAgentContext) -> tuple[str, ...]:
    if not context.attachments:
        return ("- none",)
    visible = tuple(_attachment_line(item) for item in context.attachments[:5])
    remaining = context.attachment_count - len(visible)
    return visible if remaining <= 0 else (*visible, f"- ... {remaining} more attachment(s)")


def _format_cost(amount: float, currency: str) -> str:
    return f"{currency.upper()} {amount:.2f}"


def _infra_cost_lines(context: DeepAgentContext) -> tuple[str, ...]:
    if context.infra_cost is None:
        return ("- no current Infracost estimate available",)
    lines = [
        f"- total_monthly_cost: {_format_cost(context.infra_cost.total_monthly_cost, context.infra_cost.currency)}",
    ]
    if context.infra_cost.generated_at:
        lines.append(f"- generated_at: {context.infra_cost.generated_at}")
    lines.extend(
        f"- module {module.name}: {_format_cost(module.monthly_cost, context.infra_cost.currency)}"
        for module in context.infra_cost.modules[:5]
    )
    if len(context.infra_cost.modules) > 5:
        lines.append(f"- ... {len(context.infra_cost.modules) - 5} more module(s)")
    if context.infra_cost.warnings:
        lines.append(f"- warnings: {len(context.infra_cost.warnings)}")
    return tuple(lines)


def build_runtime_context_prompt(
    base_prompt: str,
    context: DeepAgentContext,
    *,
    state_message_count: int,
) -> str:
    summary = "\n".join(
        (
            f"- project_id: {context.project_id}",
            f"- thread_id: {context.thread_id}",
            f"- input_message_count: {context.message_count}",
            f"- current_state_message_count: {state_message_count}",
            f"- attachment_count: {context.attachment_count}",
        )
    )
    sections = (
        base_prompt,
        "## Current Run Context\n" + summary,
        "## Active User Request\n" + (context.latest_user_request or "No user request text was provided."),
        "## Active Attachments\n" + "\n".join(_attachment_lines(context)),
        "## Current Infra Cost\n" + "\n".join(_infra_cost_lines(context)),
    )
    return "\n\n".join(section for section in sections if section)


def _request_system_prompt(request: ModelRequest[DeepAgentContext]) -> str:
    if request.system_message is None:
        return build_system_prompt()
    return _content_text(request.system_message.content)


def _state_message_count(request: ModelRequest[DeepAgentContext]) -> int:
    messages = request.state.get("messages")
    return len(messages) if isinstance(messages, list) else 0


def build_context_prompt_middleware() -> AgentMiddleware:
    @dynamic_prompt
    def runtime_prompt(request: ModelRequest[DeepAgentContext]) -> str:
        return build_runtime_context_prompt(
            _request_system_prompt(request),
            request.runtime.context or DeepAgentContext(),
            state_message_count=_state_message_count(request),
        )

    return runtime_prompt


def _pii_middleware(pii_type: str, detector: str | None = None) -> AgentMiddleware:
    return StructuredPIIMiddleware(
        pii_type,
        detector=detector,
        strategy="redact",
        apply_to_output=True,
        apply_to_tool_results=True,
    )


def build_pii_guardrail_middleware() -> tuple[AgentMiddleware, ...]:
    return (
        _pii_middleware("email"),
        _pii_middleware("credit_card"),
        _pii_middleware("ssn", detector=_SSN_PATTERN),
        _pii_middleware("phone_number", detector=_PHONE_PATTERN),
    )


_OPENTOFU_REVIEW_TODO = {
    "content": "Review generated OpenTofu with opentofu_validate_review and fix syntax/module errors",
    "status": "pending",
}
_OPENTOFU_REQUEST_TERMS = ("opentofu", "terraform", "tofu", "iac", "module", "infrastructure")


def _is_opentofu_request(context: DeepAgentContext | None) -> bool:
    request = (context.latest_user_request if context else "") or ""
    lowered = request.lower()
    return any(term in lowered for term in _OPENTOFU_REQUEST_TERMS)


def _is_write_todos_call(tool_call: dict[str, Any]) -> bool:
    return tool_call.get("name") == "write_todos" and isinstance(tool_call.get("args"), dict)


def _todo_content(todo: Any) -> str:
    if not isinstance(todo, dict):
        return ""
    content = todo.get("content")
    return content.lower() if isinstance(content, str) else ""


def _has_review_todo(todos: list[Any]) -> bool:
    return any(
        "opentofu_validate_review" in _todo_content(todo) or "review generated opentofu" in _todo_content(todo)
        for todo in todos
    )


def _patched_write_todos_args(args: dict[str, Any]) -> dict[str, Any]:
    todos = args.get("todos")
    if not isinstance(todos, list) or _has_review_todo(todos):
        return args
    return {**args, "todos": [*todos, dict(_OPENTOFU_REVIEW_TODO)]}


class OpenTofuReviewTodoMiddleware(AgentMiddleware):
    @hook_config(can_jump_to=["end"])
    def after_model(self, state: AgentState[Any], runtime: Any) -> dict[str, Any] | None:
        if not _is_opentofu_request(runtime.context):
            return None
        messages = state.get("messages") or []
        if not messages or not isinstance(messages[-1], AIMessage) or not messages[-1].tool_calls:
            return None
        updated_calls: list[dict[str, Any]] = []
        changed = False
        for tool_call in messages[-1].tool_calls:
            if not _is_write_todos_call(tool_call):
                updated_calls.append(tool_call)
                continue
            patched = {**tool_call, "args": _patched_write_todos_args(tool_call["args"])}
            updated_calls.append(patched)
            changed = changed or patched != tool_call
        if not changed:
            return None
        updated = list(messages)
        updated[-1] = messages[-1].model_copy(update={"tool_calls": updated_calls})
        return {"messages": updated}


def build_context_engineering_middleware(token_budget: int) -> tuple[AgentMiddleware, ...]:
    trigger = max(4096, int(token_budget or 0))
    clear_tokens = max(1024, trigger // 4)
    return (
        *build_pii_guardrail_middleware(),
        OpenTofuReviewTodoMiddleware(),
        build_context_prompt_middleware(),
        ContextEditingMiddleware(edits=[ClearToolUsesEdit(trigger=trigger, clear_at_least=clear_tokens, keep=4)]),
    )


def _opentofu_architect_blueprint() -> SubagentBlueprint:
    return SubagentBlueprint(
        name="opentofu-architect",
        description="Design a Terraform/OpenTofu + Ansible role plan from requirements.",
        mission="Produce a complete infra design plan without writing files.",
        workflow=(
            "Define module name in snake_case and target provider scope.",
            "List resources/data sources, critical arguments, variables, outputs, and locals.",
            "Define ansible_hosts output shape and whether the module needs configuration_targets plus role mapping, or explicit [] no-config outputs.",
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
            "Validate required output ansible_hosts and module-level file completeness, using require_ansible=false when no configuration targets are needed.",
            "Use inspect_opentofu_generated_code and search_generated_iac_patterns to gather supporting evidence for findings.",
            "Run opentofu_validate_review to catch syntax, init, and module-loading errors.",
            "Call validate_iac_structure before final verdict.",
            "Provide fixes with corrected snippets.",
            "Return sections: Reviewed Targets, Validator Status, Findings, Next Actions.",
        ),
        guardrails=(
            "Format findings as [SEVERITY] file:line - issue.",
            "End with VERDICT: PASS or FAIL.",
        ),
        output_contract="Return Reviewed Targets, Validator Status, Findings, VERDICT: PASS|FAIL, and Next Actions.",
    )


def _ansible_architect_blueprint() -> SubagentBlueprint:
    return SubagentBlueprint(
        name="ansible-architect",
        description="Design Ansible role/playbook structure only for generated modules that need configuration.",
        mission="Produce a role-first Ansible plan for configuration-target modules without writing files.",
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
        description="Write Ansible playbook and role files only for modules that require configuration.",
        mission="Create deterministic Ansible entrypoint and role skeletons for configuration-target modules.",
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
            "Use inspect_ansible_generated_code and search_generated_iac_patterns to strengthen Ansible findings.",
            "Call validate_iac_structure and include its result.",
            "Provide fixes if any violation is found.",
            "Return sections: Reviewed Targets, Validator Status, Findings, Next Actions.",
        ),
        guardrails=(
            "Format findings as [SEVERITY] file:line - issue.",
            "End with VERDICT: PASS or FAIL.",
        ),
        output_contract="Return Reviewed Targets, Validator Status, Findings, VERDICT: PASS|FAIL, and Next Actions.",
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


def build_async_infra_subagents(
    graph_ids: Mapping[str, str],
    *,
    url: str | None = None,
    headers: Mapping[str, str] | None = None,
) -> tuple[dict[str, Any], ...]:
    compiled = []
    shared_headers = dict(headers or {})
    for blueprint in _build_infra_blueprints():
        graph_id = graph_ids.get(blueprint.name) or graph_ids.get(blueprint.name.replace("-", "_"))
        if not graph_id:
            raise ValueError(f"missing_async_subagent_graph_id:{blueprint.name}")
        payload: dict[str, Any] = {
            "name": blueprint.name,
            "description": blueprint.description,
            "graph_id": graph_id,
        }
        if url:
            payload["url"] = url
        if shared_headers:
            payload["headers"] = shared_headers
        compiled.append(payload)
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
            "- For OpenTofu work, include an explicit review todo before completion.",
            "- Run opentofu_validate_review and validate_iac_structure before marking Terraform+Ansible generation complete.",
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
    "build_context_engineering_middleware",
    "build_context_prompt_middleware",
    "build_default_agent_md",
    "build_async_infra_subagents",
    "build_infra_subagents",
    "build_opentofu_subagents",
    "build_pii_guardrail_middleware",
    "build_prompt_bundle",
    "build_runtime_context_prompt",
    "build_system_prompt",
    "INFRA_SUBAGENTS",
    "OPENTOFU_SUBAGENTS",
    "SYSTEM_PROMPT",
    "_DEFAULT_AGENT_MD",
]
