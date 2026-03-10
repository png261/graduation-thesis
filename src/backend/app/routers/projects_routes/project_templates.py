from __future__ import annotations

from app.services.project import files as project_files
from app.services.agent import invalidate_agent

_TEMPLATES: dict[str, dict] = {
    "opentofu": {
        "skills": [
            {
                "name": "opentofu-module",
                "description": (
                    "Generate a complete, runnable OpenTofu module with all required files "
                    "following HashiCorp best practices"
                ),
                "content": """\
---
name: opentofu-module
description: Generate a complete, runnable OpenTofu module with all required files following HashiCorp best practices
---

# OpenTofu Module Generation Skill

## When to Use
When the user asks to create cloud infrastructure, an OpenTofu module, or any
resource definition (VPC, EC2, RDS, S3, IAM, EKS, Lambda, etc.).

## Required Files (every module)

```
modules/<name>/
├── versions.tf
├── main.tf
├── variables.tf
├── outputs.tf
├── README.md
└── examples/basic/main.tf
```

## Execution Steps
1. Call `opentofu-architect` → get design plan
2. Call `opentofu-coder` → write files to `modules/<name>/`
3. Call `opentofu-reviewer` → validate; fix reported issues
4. Confirm all required files exist with `ls modules/<name>/`
""",
            },
            {
                "name": "opentofu-security",
                "description": (
                    "Security checklist for OpenTofu modules: encryption, IAM, "
                    "network policies, and secrets management"
                ),
                "content": """\
---
name: opentofu-security
description: Security checklist for OpenTofu modules: encryption, IAM, network policies, and secrets management
---

# OpenTofu Security Skill

## When to Use
Before finalising any OpenTofu module. Run opentofu-reviewer and verify this checklist.

## Mandatory Controls

### Secrets & Credentials
- [ ] No `password`, `secret`, `key`, `token` literals in `.tf` files
- [ ] Use `var.*` or `data.aws_secretsmanager_secret_version.*` for credentials
- [ ] Mark sensitive variables: `sensitive = true`

### Encryption
- [ ] S3: `server_side_encryption_configuration` block, `aws_s3_bucket_public_access_block`
- [ ] RDS: `storage_encrypted = true`, `kms_key_id`
- [ ] EBS volumes: `encrypted = true`
- [ ] In-transit: `aws_lb_listener` uses HTTPS (port 443)

### IAM Least Privilege
- [ ] No `"*"` in `actions` unless explicitly justified
- [ ] No `"*"` in `resources` for sensitive services (S3, Secrets Manager, KMS)
- [ ] EC2 instances use an instance profile, not embedded credentials

### Network
- [ ] Security groups: no `0.0.0.0/0` ingress except ports 80/443
- [ ] VPC flow logs enabled
- [ ] Private subnets for databases and internal services
""",
            },
        ],
    }
}

KNOWN_TEMPLATES = list(_TEMPLATES.keys())


def init_project_template(project_id: str, template_name: str) -> dict:
    if template_name not in _TEMPLATES:
        return {
            "ok": False,
            "error": f"Unknown template '{template_name}'. Available: {KNOWN_TEMPLATES}",
        }

    template = _TEMPLATES[template_name]
    for skill in template["skills"]:
        project_files.write_text(project_id, f"/skills/{skill['name']}/SKILL.md", skill["content"])

    root = project_files.ensure_project_dir(project_id)
    (root / "modules").mkdir(parents=True, exist_ok=True)
    (root / "environments").mkdir(parents=True, exist_ok=True)

    invalidate_agent(project_id)
    return {
        "ok": True,
        "template": template_name,
        "skills_added": [skill["name"] for skill in template["skills"]],
    }
