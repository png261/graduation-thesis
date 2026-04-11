---
name: infra-validation
description: Validate generated infrastructure with required checks and evidence before completion.
---

# Infrastructure Validation Skill

Use this skill before declaring infrastructure generation complete.

## Required Checks

- Validate Terraform/OpenTofu output against `terraform-generate`.
- Validate Ansible output against `ansible-generate` when configuration targets exist.
- Run `opentofu_validate_review` and `validate_iac_structure` before completion.
- When no configuration targets exist, run `validate_iac_structure` with `require_ansible=false`.
- Treat contract violations as blocking failures.

## Supporting Evidence

Use these tools to strengthen findings:
- `get_infra_costs`
- `inspect_opentofu_generated_code`
- `inspect_ansible_generated_code`
- `search_generated_iac_patterns`

## Completion Evidence

For substantial tasks, include:
- Changed files
- Validations run
- Pass/fail evidence
- Unresolved risks
