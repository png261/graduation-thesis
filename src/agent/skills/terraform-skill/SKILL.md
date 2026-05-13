---
name: terraform-skill
description: Terraform and OpenTofu authoring, review, debugging, testing, CI, state, drift, security, and module design guidance for the single Infrastructure agent. Use whenever a request involves Terraform, OpenTofu, HCL, providers, modules, plans, applies, state, drift, Terratest, tflint, or IaC security.
---

# Terraform/OpenTofu Skill

Use this skill for Terraform or OpenTofu work.

## Workflow

1. Clarify target cloud, provider versions, backend, environments, and safety constraints before changing infrastructure.
2. Prefer stable resource addresses and deterministic for_each keys; avoid count when identity stability matters.
3. Use typed variables, bounded provider versions, explicit provider wiring, clear outputs, and module contracts.
4. Use registry documentation for provider schemas instead of guessing resource arguments.
5. Protect secrets: never put secret defaults in variables, outputs, logs, plan summaries, generated docs, or state migration notes.
6. For fixes, make targeted edits and preserve state addresses unless the user explicitly approves a migration.
7. Validate with fmt, init -backend=false where possible, validate, tflint/checkov when available, and plan/apply only when the user asks for it.
8. For CI, include drift checks, concurrency controls, plan artifacts, policy gates, and explicit approval boundaries.

## Local References

- references/coding-standards.md
- references/module-architecture.md
- references/identity-churn.md
- references/secret-exposure.md
- references/do-dont-patterns.md
- references/examples-good.md
- references/examples-bad.md
- references/examples-neutral.md
- references/quick-ops.md
- references/testing-matrix.md
- references/ci-delivery-patterns.md
- references/ci-drift.md
- references/compliance-gates.md
- references/structure-and-state.md
- references/blast-radius.md
- references/security-and-governance.md
- references/mcp-integration.md
- references/conditional/trusted-modules.md

## Output Focus

Return complete file changes or commands, concrete validation evidence, and risk notes. Keep destructive operations explicit and gated.
