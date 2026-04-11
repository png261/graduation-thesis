---
name: infra-execution-safety
description: Enforce safe two-step execution flows for preview, deploy apply, and Ansible run actions.
---

# Infrastructure Execution Safety Skill

Use this skill for deploy or configuration execution actions.

## Deploy Safety

- Run `opentofu_preview_deploy` before apply decisions.
- Run `opentofu_apply_deploy` in two steps:
  1. `confirm=false`
  2. `confirm=true` only after explicit user confirmation

## Configuration Safety

- Run `ansible_run_config` in two steps:
  1. `confirm=false`
  2. `confirm=true` only after explicit user confirmation
