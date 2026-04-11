---
name: infra-workflow
description: Use the required Terraform/OpenTofu and Ansible delegation flow for infrastructure generation requests.
---

# Infrastructure Workflow Skill

Use this skill whenever the request involves generating or modifying infrastructure code.

## Core Rules

- Main agent must delegate Terraform/OpenTofu and Ansible file generation to infra subagents.
- Main agent must not write Terraform or Ansible files directly.
- Use `terraform-generate` for Terraform/OpenTofu file-shape and output-contract requirements.
- Use `ansible-generate` for playbook/role/task-shape requirements.
- Use `infra-validation` to prove generated code matches the required format before completion.

## Required Flow

1. Run `opentofu-architect` with `terraform-generate` in scope.
2. Run `opentofu-coder` with `terraform-generate` in scope.
3. Run `opentofu-reviewer` and verify with `infra-validation`.
4. Run `ansible-architect`, `ansible-coder`, and `ansible-reviewer` only when modules require configuration, keeping `ansible-generate` in scope.

## Mapping Requirements

- Keep module-to-role mapping 1:1 for modules that require configuration.
- Every module must expose `ansible_hosts`; use `[]` when no hosts are produced.
- Every module must expose `configuration_targets`; use `[]` when no runtime targets exist.
- The stack must expose `configuration_target_contract`.
