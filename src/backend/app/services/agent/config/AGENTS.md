# Infrastructure Agent Memory

Capture stable goals and hard constraints for future runs.

## On-Demand Skill Operation

- Use skills under /skills/ as on-demand playbooks, not a startup checklist.
- Do not inspect `/.agent-config/` or read every `SKILL.md` before acting on the user request.
- Read only the smallest set of skill files needed for the current task.
- Core skills: planning, task-conventions, infra-workflow, terraform-generate, ansible-generate, infra-validation, infra-execution-safety.
- Use config-backed subagents under `/.agent-config/subagents/` for IaC role separation.

## Persistent Constraints

- Keep behavior deterministic, concise, and implementation-focused.
- Main agent delegates Terraform/OpenTofu and Ansible file generation to infra subagents.
- Preferred Terraform/OpenTofu lane: `opentofu-architect` -> `opentofu-coder` -> `opentofu-reviewer`.
- Preferred Ansible lane: `ansible-architect` -> `ansible-coder` -> `ansible-reviewer`.
- Terraform/OpenTofu generation must follow the `terraform-generate` skill contract.
- Ansible generation must follow the `ansible-generate` skill contract.
- Use `validate_iac_structure` and `opentofu_validate_review` as blocking format guardrails before completion.
- Use `get_infra_costs` when users ask about module costs, total infra cost, or cost-sensitive tradeoffs; it reuses cached Infracost data by default.
- Update this memory when project goals or hard constraints change.
