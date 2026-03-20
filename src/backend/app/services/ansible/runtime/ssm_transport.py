"""SSM transport preparation helpers for Ansible runtime."""

from __future__ import annotations

from pathlib import Path
import re
from typing import Any

_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9_.-]+")
_WINDOWS_PLATFORMS = {"windows", "win32"}


class SsmTransportError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _text(value: Any) -> str:
    return str(value or "").strip()


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return sorted({_text(item) for item in value if _text(item)})


def _safe_name(value: str) -> str:
    cleaned = _SAFE_NAME_RE.sub("_", value).strip("._-")
    return cleaned or "target"


def _target_sort_key(target: dict[str, Any]) -> tuple[str, str]:
    return (_text(target.get("execution_id")), _text(target.get("display_name")))


def _transport_target(raw: dict[str, Any]) -> dict[str, Any]:
    execution_id = _text(raw.get("execution_id"))
    if not execution_id:
        raise SsmTransportError("ssm_transport_identity_missing", "SSM transport target is missing execution_id.")
    resolved_instance_id = _text(raw.get("resolved_instance_id"))
    resolved_managed_instance_id = _text(raw.get("resolved_managed_instance_id"))
    transport_instance_id = resolved_managed_instance_id or resolved_instance_id
    if not transport_instance_id:
        raise SsmTransportError(
            "ssm_transport_identity_missing",
            f"SSM transport target {execution_id} is missing a resolved SSM instance identity.",
        )
    role = _text(raw.get("role"))
    if not role:
        raise SsmTransportError("ssm_transport_role_missing", f"SSM transport target {execution_id} is missing role.")
    source_modules = _string_list(raw.get("source_modules"))
    if not source_modules:
        raise SsmTransportError(
            "ssm_transport_source_modules_missing",
            f"SSM transport target {execution_id} is missing source_modules.",
        )
    if not bool(raw.get("ready")):
        raise SsmTransportError("ssm_target_not_ready", f"SSM transport target {execution_id} is not ready yet.")
    expected_platform = _text(raw.get("expected_platform")).lower() or None
    return {
        "inventory_name": _safe_name(execution_id),
        "execution_id": execution_id,
        "transport_instance_id": transport_instance_id,
        "resolved_instance_id": resolved_instance_id or None,
        "resolved_managed_instance_id": resolved_managed_instance_id or None,
        "display_name": _text(raw.get("display_name")) or execution_id,
        "role": role,
        "source_modules": source_modules,
        "expected_platform": expected_platform,
        "groups": sorted({_safe_name(role), *(_safe_name(module) for module in source_modules)}),
    }


def build_ssm_transport_targets(readiness: dict[str, Any]) -> list[dict[str, Any]]:
    if bool(readiness.get("blocking")):
        raise SsmTransportError(
            _text(readiness.get("blocker_code")) or "ssm_target_not_ready",
            _text(readiness.get("blocker_message")) or "AWS Systems Manager readiness failed.",
        )
    targets = readiness.get("targets")
    if not isinstance(targets, list) or not targets:
        raise SsmTransportError(
            "ssm_transport_targets_missing",
            "No scoped SSM-ready targets are available for configuration.",
        )
    return [_transport_target(target) for target in sorted(targets, key=_target_sort_key) if isinstance(target, dict)]


def apply_ssm_transport_config(
    targets: list[dict[str, Any]],
    *,
    aws_region: str,
    bucket_name: str,
) -> list[dict[str, Any]]:
    region = _text(aws_region)
    if not region:
        raise SsmTransportError("ssm_credentials_missing", "AWS region is required for SSM transport.")
    bucket = _text(bucket_name)
    if not bucket:
        raise SsmTransportError(
            "ssm_transport_bucket_missing",
            "ANSIBLE_AWS_SSM_BUCKET_NAME is required for Ansible SSM transport.",
        )
    configured: list[dict[str, Any]] = []
    for target in targets:
        shell_type = "powershell" if _text(target.get("expected_platform")).lower() in _WINDOWS_PLATFORMS else None
        configured.append({**target, "aws_region": region, "bucket_name": bucket, "shell_type": shell_type})
    return configured


def write_ssm_inventory(targets: list[dict[str, Any]], *, runtime_root: Path) -> Path:
    if not targets:
        raise SsmTransportError("ssm_transport_targets_missing", "No SSM transport targets were provided.")
    bucket_name = _text(targets[0].get("bucket_name"))
    aws_region = _text(targets[0].get("aws_region"))
    if not bucket_name or not aws_region:
        raise SsmTransportError("ssm_transport_invalid", "SSM transport targets are missing region or bucket config.")
    lines = ["[all]"]
    groups: dict[str, list[str]] = {}
    for target in targets:
        host_name = _text(target.get("inventory_name"))
        instance_id = _text(target.get("transport_instance_id"))
        if not host_name or not instance_id:
            raise SsmTransportError("ssm_transport_invalid", "SSM transport target is missing inventory identity.")
        parts = [host_name, f"ansible_aws_ssm_instance_id={instance_id}"]
        shell_type = _text(target.get("shell_type"))
        if shell_type:
            parts.append(f"ansible_shell_type={shell_type}")
        lines.append(" ".join(parts))
        for group in _string_list(target.get("groups")):
            groups.setdefault(group, [])
            if host_name not in groups[group]:
                groups[group].append(host_name)
    lines.extend(["", "[all:vars]"])
    lines.extend(
        [
            "ansible_connection=amazon.aws.aws_ssm",
            f"ansible_aws_ssm_bucket_name={bucket_name}",
            f"ansible_aws_ssm_region={aws_region}",
        ]
    )
    for group in sorted(groups):
        lines.extend(["", f"[{group}]"])
        lines.extend(groups[group])
    inventory_path = runtime_root / "inventory.ini"
    inventory_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return inventory_path


def transport_summary(targets: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "mode": "ssm",
        "target_count": len(targets),
        "target_ids": [_text(target.get("execution_id")) for target in targets],
        "display_names": [_text(target.get("display_name")) for target in targets],
    }
