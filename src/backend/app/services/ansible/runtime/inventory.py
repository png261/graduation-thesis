"""Inventory parsing and rendering helpers for Ansible runtime."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

_SAFE_ALIAS_RE = re.compile(r"[^A-Za-z0-9_.-]+")


class AnsibleInventoryError(ValueError):
    """Raised when Terraform outputs cannot be converted into inventory data."""


@dataclass(frozen=True)
class AnsibleHost:
    """Normalized host record used by inventory generation and runtime events."""

    module: str
    name: str
    address: str
    user: str | None = None
    port: int | None = None
    groups: tuple[str, ...] = ()
    vars: dict[str, str] | None = None


def _as_output_value(raw: Any) -> Any:
    if isinstance(raw, dict) and "value" in raw:
        return raw.get("value")
    return raw


def _validate_groups(raw: Any, *, module: str, index: int) -> tuple[str, ...]:
    if raw is None:
        return ()
    if not isinstance(raw, list):
        raise AnsibleInventoryError(
            f"modules/{module}: ansible_hosts[{index}].groups must be a list of strings"
        )
    groups: list[str] = []
    for value in raw:
        text = str(value).strip()
        if not text:
            continue
        groups.append(text)
    return tuple(groups)


def _validate_vars(raw: Any, *, module: str, index: int) -> dict[str, str] | None:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise AnsibleInventoryError(
            f"modules/{module}: ansible_hosts[{index}].vars must be an object map"
        )
    parsed: dict[str, str] = {}
    for key, value in raw.items():
        key_text = str(key).strip()
        if not key_text:
            continue
        parsed[key_text] = str(value)
    return parsed or None


def _validate_port(raw: Any, *, module: str, index: int) -> int | None:
    if raw in (None, ""):
        return None
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise AnsibleInventoryError(
            f"modules/{module}: ansible_hosts[{index}].port must be an integer"
        ) from exc
    if value <= 0:
        raise AnsibleInventoryError(
            f"modules/{module}: ansible_hosts[{index}].port must be greater than 0"
        )
    return value


def parse_ansible_hosts_output(module: str, tofu_output_json: dict[str, Any]) -> list[AnsibleHost]:
    """Parse and validate the `ansible_hosts` Terraform output contract."""
    output = tofu_output_json.get("ansible_hosts")
    if output is None:
        raise AnsibleInventoryError(f"modules/{module}: missing required output `ansible_hosts`")
    value = _as_output_value(output)
    if not isinstance(value, list):
        raise AnsibleInventoryError(f"modules/{module}: output `ansible_hosts` must be a list")

    hosts: list[AnsibleHost] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise AnsibleInventoryError(
                f"modules/{module}: ansible_hosts[{index}] must be an object"
            )
        name = str(item.get("name") or "").strip()
        address = str(item.get("address") or "").strip()
        if not name:
            raise AnsibleInventoryError(
                f"modules/{module}: ansible_hosts[{index}].name is required"
            )
        if not address:
            raise AnsibleInventoryError(
                f"modules/{module}: ansible_hosts[{index}].address is required"
            )
        user = str(item.get("user")).strip() if item.get("user") not in (None, "") else None
        port = _validate_port(item.get("port"), module=module, index=index)
        groups = _validate_groups(item.get("groups"), module=module, index=index)
        vars_map = _validate_vars(item.get("vars"), module=module, index=index)
        hosts.append(
            AnsibleHost(
                module=module,
                name=name,
                address=address,
                user=user,
                port=port,
                groups=groups,
                vars=vars_map,
            )
        )
    return hosts


def _safe_alias(name: str) -> str:
    alias = _SAFE_ALIAS_RE.sub("_", name).strip("._-")
    return alias or "host"


def _host_line(alias: str, host: AnsibleHost) -> str:
    chunks = [alias, f"ansible_host={host.address}"]
    if host.user:
        chunks.append(f"ansible_user={host.user}")
    if host.port:
        chunks.append(f"ansible_port={host.port}")
    if host.vars:
        for key in sorted(host.vars.keys()):
            chunks.append(f"{key}={host.vars[key]}")
    return " ".join(chunks)


def build_inventory_ini(hosts: list[AnsibleHost], *, ssh_key_path: str) -> str:
    """Render INI inventory text for ansible-playbook."""
    if not hosts:
        raise AnsibleInventoryError("No hosts provided for inventory generation")

    alias_counts: dict[str, int] = {}
    alias_by_idx: list[str] = []
    for host in hosts:
        base_alias = _safe_alias(host.name)
        count = alias_counts.get(base_alias, 0)
        alias_counts[base_alias] = count + 1
        alias = base_alias if count == 0 else f"{base_alias}_{count + 1}"
        alias_by_idx.append(alias)

    lines: list[str] = ["[all]"]
    group_members: dict[str, list[str]] = {}

    for idx, host in enumerate(hosts):
        alias = alias_by_idx[idx]
        lines.append(_host_line(alias, host))
        for group in host.groups:
            group_members.setdefault(group, [])
            if alias not in group_members[group]:
                group_members[group].append(alias)

    lines.extend(["", "[all:vars]"])
    lines.append(f"ansible_ssh_private_key_file={ssh_key_path}")

    if group_members:
        for group_name in sorted(group_members.keys()):
            lines.extend(["", f"[{group_name}]"])
            lines.extend(group_members[group_name])
    lines.append("")
    return "\n".join(lines)
