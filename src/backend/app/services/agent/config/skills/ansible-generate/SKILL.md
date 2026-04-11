---
name: ansible-generate
description: Generate Ansible playbooks and roles that follow the required IaC host, role, and task contract.
---

# Ansible Generate Skill

Use this skill whenever the task is to generate or update Ansible configuration code.

## Required Output Format

When configuration targets exist, create:
- `playbooks/site.yml`
- `roles/<module>/tasks/main.yml`
- `roles/<module>/defaults/main.yml`

Role mapping:
- Keep module-to-role mapping 1:1 for modules that require configuration.
- Use the same module name for the Ansible role unless the request explicitly requires a different deterministic mapping.

Playbook contract:
- `playbooks/site.yml` must declare at least one `hosts:` entry.
- The playbook must wire the generated roles explicitly.

Role contract:
- Every `roles/<module>/tasks/main.yml` must contain at least one named task item.
- Keep tasks explicit and idempotent.
- Keep defaults in `roles/<module>/defaults/main.yml`.

Terraform/OpenTofu dependency contract:
- Expect every generated module to expose `ansible_hosts`.
- Expect every generated module to expose `configuration_targets`.
- If no modules require configuration, skip playbooks/roles and validate with `require_ansible=false` instead of creating empty Ansible scaffolding.

## Generation Rules

- Generate only the smallest valid playbook/role set needed for the selected modules.
- Keep host targeting deterministic and aligned with Terraform/OpenTofu outputs.
- Avoid hidden logic or overly abstract role composition when a direct role is sufficient.
- Preserve execution safety assumptions so later `ansible_run_config` uses clear, reviewable targets.

## Guardrails

Before declaring Ansible generation complete:
- Run `validate_iac_structure` with `require_ansible=true` when configuration targets exist.
- If no configuration targets exist, use `validate_iac_structure(require_ansible=false)`.
- Treat missing `hosts`, missing roles, or unnamed tasks as blocking format failures.
