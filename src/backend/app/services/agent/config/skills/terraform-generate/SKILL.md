---
name: terraform-generate
description: Generate Terraform/OpenTofu modules and stacks that follow the required IaC file, output, and example contract.
---

# Terraform Generate Skill

Use this skill whenever the task is to generate or update Terraform/OpenTofu code.

## Required Output Format

For every generated module under `modules/<module>/`, create:
- `versions.tf`
- `providers.tf`
- `main.tf`
- `variables.tf`
- `outputs.tf`
- `README.md`
- `examples/basic/main.tf`

Optional:
- `locals.tf`

For every module:
- Declare output `ansible_hosts`; use `[]` when no hosts are produced.
- Declare output `configuration_targets`; use `[]` when no configuration/runtime targets exist.
- Ensure both output blocks contain a `value = ...` assignment.
- Keep `ansible_hosts` entries shaped with at least `name` and `address`.
- Keep `configuration_targets` entries shaped with at least `execution_id`, `role`, and `source_modules`.

For the stack:
- `stacks/main/outputs.tf` must declare `configuration_target_contract`.
- The canonical output block must contain a `value = ...` assignment.

Examples:
- Every `modules/<module>/examples/basic/main.tf` must reference the module with `source = "../../"`.

## Generation Rules

- Generate deterministic, explicit Terraform/OpenTofu only.
- Prefer the smallest valid module/stack edit that satisfies the request.
- Preserve 1:1 mapping between a configured module and its Ansible role name.
- If no configuration targets are needed, still emit `ansible_hosts = []` and `configuration_targets = []`.
- Do not invent extra file layers when the standard module contract is enough.

## Guardrails

Before declaring Terraform/OpenTofu generation complete:
- Run `opentofu_validate_review` for the selected modules when Terraform/OpenTofu files were generated.
- Run `validate_iac_structure`.
- If the project does not require configuration, use `validate_iac_structure(require_ansible=false)`.
- Treat any contract mismatch as blocking, not advisory.
